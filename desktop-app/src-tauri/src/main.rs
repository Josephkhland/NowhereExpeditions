#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{collections::HashMap, io::{BufRead, BufReader, Write}, process::{Command, Stdio, ChildStdin}, sync::{Arc, Mutex, atomic::{AtomicU64, AtomicBool, Ordering}}, path::PathBuf};
use tauri::{Manager, Emitter, Listener, WebviewUrl, webview::WebviewBuilder};
use serde_json::{Value, json};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_clipboard_manager::ClipboardExt;
#[cfg(windows)] use std::os::windows::process::CommandExt;
struct Service { input: Mutex<ChildStdin>, pending: Mutex<HashMap<u64,tokio::sync::oneshot::Sender<Result<Value,String>>>>, next: AtomicU64, closing: AtomicBool, dashboard: Mutex<Option<String>> }
impl Service { fn send(&self,v:Value)->Result<(),String>{let mut input=self.input.lock().unwrap();writeln!(input,"{}",v).map_err(|e|e.to_string())} }
fn trusted(w:&tauri::Webview)->bool { let Ok(u)=w.url() else{return false}; u.scheme()=="tauri" || (u.scheme()=="http" && u.host_str()==Some("tauri.localhost")) }
#[tauri::command]
async fn service(webview:tauri::Webview, state:tauri::State<'_,Arc<Service>>, channel:String,args:Vec<Value>)->Result<Value,String>{
 if !trusted(&webview){return Err("Untrusted page".into())}
 let page=webview.label();let allowed=match page {"terminal"=>channel.starts_with("term:")||channel.starts_with("mem:"),"git"=>channel.starts_with("git:"),"marketing"=>channel=="mk:run",_=>false};
 if !allowed{return Err("Not allowed".into())}
 let id=state.next.fetch_add(1,Ordering::Relaxed);let(tx,rx)=tokio::sync::oneshot::channel();state.pending.lock().unwrap().insert(id,tx);
 if let Err(e)=state.send(json!({"id":id,"page":page,"channel":channel,"args":args})){state.pending.lock().unwrap().remove(&id);return Err(e)}
 match tokio::time::timeout(std::time::Duration::from_secs(600),rx).await {Ok(Ok(v))=>v,_=>{state.pending.lock().unwrap().remove(&id);Err("Service request timed out or closed".into())}}
}
fn url_for(app:&tauri::AppHandle,id:&str)->Option<WebviewUrl>{Some(match id{
 "live"=>WebviewUrl::External("https://josephkhland.github.io/NowhereExpeditions/".parse().ok()?),
 "manager"=>WebviewUrl::External("http://127.0.0.1:8001/".parse().ok()?),"site"=>WebviewUrl::External("http://127.0.0.1:8000/".parse().ok()?),"insights"=>WebviewUrl::External("http://127.0.0.1:8002/".parse().ok()?),
 "bot"=>WebviewUrl::External(app.state::<Arc<Service>>().dashboard.lock().unwrap().as_ref()?.parse().ok()?),
 "terminal"|"git"|"marketing"=>WebviewUrl::App(format!("{}.html",id).into()),_=>return None})}
#[tauri::command]
fn dashboard_available(webview:tauri::Webview,state:tauri::State<'_,Arc<Service>>)->Result<bool,String>{
 if !trusted(&webview)||webview.label()!="main"{return Err("Not allowed".into())}
 Ok(state.dashboard.lock().unwrap().is_some())
}
#[tauri::command]
async fn tab(app:tauri::AppHandle,webview:tauri::Webview,id:String,action:String,text:Option<String>)->Result<(),String>{
 if !trusted(&webview)||webview.label()!="main" {return Err("Not allowed".into())}
 let url=url_for(&app,&id).ok_or("Tab unavailable")?;
 let window=app.get_window("main").ok_or("Window unavailable")?;
 if action=="select" {
 if app.get_webview(&id).is_none(){
 let local=matches!(id.as_str(),"terminal"|"git"|"marketing");
 let handle=app.clone();let tab_id=id.clone();
 let origin=match &url {WebviewUrl::External(u)=>Some(u.origin()),_=>None};
 let nav=origin.clone();
 let builder=WebviewBuilder::new(&id,url).on_navigation(move |u|{
 if local {return u.scheme()=="tauri" || u.host_str()==Some("tauri.localhost")}
 if Some(u.origin())==nav{return true}
 if tab_id=="live" && matches!(u.scheme(),"http"|"https") && u.port_or_known_default()!=Some(8766){return true}
 if tab_id!="bot" && matches!(u.scheme(),"http"|"https"){let _=handle.opener().open_url(u.as_str(),None::<&str>);}false
 }).on_new_window(|_,_|tauri::webview::NewWindowResponse::Deny);
 let size=window.inner_size().map_err(|e|e.to_string())?.to_logical::<f64>(window.scale_factor().unwrap_or(1.));
 window.add_child(builder,tauri::LogicalPosition::new(0.,46.),tauri::LogicalSize::new(size.width,(size.height-46.).max(1.))).map_err(|e|e.to_string())?;
 }
 for w in window.webviews(){if w.label()=="main"{continue}if w.label()==id{w.show().ok();w.set_focus().ok();}else{w.hide().ok();}}
 }else if let Some(w)=app.get_webview(&id){match action.as_str(){
 "reload"=>{w.reload().map_err(|e|e.to_string())?;},"back"=>{w.eval("history.back()").map_err(|e|e.to_string())?;},
 "navigate" if id=="live"=>{let s=text.unwrap_or_default();let u:tauri::Url=if s.contains("://"){s}else{format!("https://{}",s)}.parse().map_err(|_|"Invalid address")?;if !matches!(u.scheme(),"http"|"https") || u.port_or_known_default()==Some(8766){return Err("Address not allowed".into())} w.navigate(u).map_err(|e|e.to_string())?;},
 "browser" if id!="bot" && !matches!(id.as_str(),"terminal"|"git"|"marketing")=>{app.opener().open_url(w.url().map_err(|e|e.to_string())?.as_str(),None::<&str>).map_err(|e|e.to_string())?;},_=>{}}}
 Ok(())
}
fn native(app:&tauri::AppHandle,m:&Value)->Result<Value,String>{let a=&m["args"];match m["action"].as_str().unwrap_or(""){
 "clipboardWrite"=>{app.clipboard().write_text(a[0].as_str().ok_or("Missing text")?).map_err(|e|e.to_string())?;Ok(Value::Null)},
 "clipboardRead"=>Ok(json!(app.clipboard().read_text().unwrap_or_default())),
 "openUrl"=>{let url=a[0].as_str().ok_or("Missing URL")?;let u:tauri::Url=url.parse().map_err(|_|"Invalid URL")?;if !matches!(u.scheme(),"http"|"https")||u.port_or_known_default()==Some(8766){return Err("URL not allowed".into())}app.opener().open_url(url,None::<&str>).map_err(|e|e.to_string())?;Ok(Value::Null)},
 "openPath"=>{app.opener().open_path(a[0].as_str().ok_or("Missing path")?,None::<&str>).map_err(|e|e.to_string())?;Ok(Value::Null)},
 "saveDialog"=>{let o=&a[0];let mut dialog=app.dialog().file();if let Some(p)=o["defaultPath"].as_str(){let p=PathBuf::from(p);if let Some(parent)=p.parent(){dialog=dialog.set_directory(parent);}if let Some(n)=p.file_name(){dialog=dialog.set_file_name(n.to_string_lossy());}}let file=dialog.blocking_save_file();Ok(match file{Some(p)=>json!({"canceled":false,"filePath":p.to_string()}),None=>json!({"canceled":true})})},_=>Err("Unknown native action".into())}}
fn main(){tauri::Builder::default()
.plugin(tauri_plugin_single_instance::init(|app,args,_|{if let Some(w)=app.get_window("main"){w.unminimize().ok();w.show().ok();w.set_focus().ok();}if let Some(t)=args.iter().find_map(|a|a.strip_prefix("--tab=")){app.emit_to("main","host-event",json!({"channel":"open-tab","args":[t]})).ok();}}))
.plugin(tauri_plugin_dialog::init()).plugin(tauri_plugin_clipboard_manager::init()).plugin(tauri_plugin_opener::init()).plugin(tauri_plugin_window_state::Builder::default().build())
.invoke_handler(tauri::generate_handler![service,tab,dashboard_available])
.setup(|app|{
 // This toolkit is repository based: locate its Node services beside this Cargo project.
 let folder=PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_owned();
 let media=folder.parent().unwrap().join("marketing_promotion");
 if media.exists(){app.asset_protocol_scope().allow_directory(&media,true)?;}
 if let Some(media)=std::env::var_os("NE_APP_MARKETING_DIR") {app.asset_protocol_scope().allow_directory(PathBuf::from(media),true)?;}
 let data=app.path().app_data_dir()?;std::fs::create_dir_all(&data)?;
 let mut cmd=Command::new("node");cmd.arg(folder.join("service.js")).args(std::env::args().skip(1)).current_dir(&folder).env("NE_APP_DATA",data).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit());
 #[cfg(windows)] cmd.creation_flags(0x08000000);
 let mut child=cmd.spawn()?;let output=child.stdout.take().unwrap();
 let state=Arc::new(Service{input:Mutex::new(child.stdin.take().unwrap()),pending:Mutex::new(HashMap::new()),next:AtomicU64::new(1),closing:AtomicBool::new(false),dashboard:Mutex::new(None)});app.manage(state.clone());
 let handle=app.handle().clone();let reader=state.clone();
 std::thread::spawn(move||{for line in BufReader::new(output).lines(){let Ok(line)=line else{break};let Ok(m)=serde_json::from_str::<Value>(&line) else{continue};
 if let Some(id)=m["id"].as_u64(){if let Some(tx)=reader.pending.lock().unwrap().remove(&id){let _=tx.send(if let Some(e)=m["error"].as_str(){Err(e.into())}else{Ok(m["result"].clone())});}}
 else if let Some(id)=m["native"].as_u64(){let h=handle.clone();let s=reader.clone();std::thread::spawn(move||{let reply=match native(&h,&m){Ok(r)=>json!({"nativeReply":id,"result":r}),Err(e)=>json!({"nativeReply":id,"error":e})};s.send(reply).ok();});}
 else if let Some(page)=m["page"].as_str(){
 if m["channel"]=="dashboard"{if let Some(url)=m["args"][0].as_str(){*reader.dashboard.lock().unwrap()=Some(url.into());if let Some(w)=handle.get_webview("bot"){if let Ok(u)=url.parse(){w.navigate(u).ok();}}handle.emit_to("main","host-event",json!({"channel":"dashboard","args":[]})).ok();}continue;}
 handle.emit_to(page,"host-event",m.clone()).ok();}
 }reader.pending.lock().unwrap().clear();let _=child.wait();if reader.closing.load(Ordering::Relaxed){handle.exit(0);}else{handle.emit_to("main","host-event",json!({"channel":"service-error","args":[]})).ok();}});
 let window=tauri::window::WindowBuilder::new(app,"main").title("Nowhere Expeditions").inner_size(1440.,920.).min_inner_size(720.,480.).build()?;
 let size=window.inner_size()?.to_logical::<f64>(window.scale_factor()?);
 window.add_child(WebviewBuilder::new("main",WebviewUrl::App("shell.html".into())),tauri::LogicalPosition::new(0.,0.),tauri::LogicalSize::new(size.width,46.))?;
 let h=app.handle().clone();window.on_window_event(move|e|match e{
 tauri::WindowEvent::Resized(_)=>{if let Some(w)=h.get_window("main"){if let Ok(s)=w.inner_size(){let s=s.to_logical::<f64>(w.scale_factor().unwrap_or(1.));for v in w.webviews(){let bar=v.label()=="main";v.set_size(tauri::LogicalSize::new(s.width,if bar{46.}else{(s.height-46.).max(1.)})).ok();}}}},
 tauri::WindowEvent::CloseRequested{api,..}=>{api.prevent_close();let s=h.state::<Arc<Service>>();if s.closing.load(Ordering::Relaxed){return}let h=h.clone();std::thread::spawn(move||{if h.dialog().message("Closing stops the servers, bot and Claude Code sessions.").title("Nowhere Expeditions").buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancel).blocking_show(){let s=h.state::<Arc<Service>>();s.closing.store(true,Ordering::Relaxed);s.send(json!({"channel":"shutdown"})).ok();}});},_=>{}});
 let start=std::env::args().find_map(|s|s.strip_prefix("--tab=").map(str::to_owned)).unwrap_or("manager".into());
 let h=app.handle().clone();app.listen("shell-ready",move |_|{h.emit_to("main","host-event",json!({"channel":"open-tab","args":[start]})).ok();});
 Ok(())}).run(tauri::generate_context!()).expect("Could not run Nowhere Expeditions");}
