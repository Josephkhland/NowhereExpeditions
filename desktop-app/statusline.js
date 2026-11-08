// Claude Code's status line when the desktop app starts it (passed with --settings, see terminal.js).
//
// Claude Code sends session data as JSON on stdin after each response, including rate_limits (Pro and Max
// plans): five_hour (the session limit) and seven_day (the weekly one), each { used_percentage, resets_at }.
// This prints a short status line for Claude Code's own footer and, when the app set NE_APP_LIMITS_FILE,
// saves the limits there for the Terminal tab's folder bar.

"use strict";

const fs = require("node:fs");

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let data = {};
  try {
    data = JSON.parse(input.replace(/^﻿/, "")); // a byte-order mark, if the sender added one
  } catch {
    return;
  }
  const limits = data.rate_limits || {};
  const file = process.env.NE_APP_LIMITS_FILE;
  if (file && (limits.five_hour || limits.seven_day)) {
    try {
      const keep = (w) => (w && typeof w.used_percentage === "number" ? { used_percentage: w.used_percentage, resets_at: w.resets_at } : null);
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ five_hour: keep(limits.five_hour), seven_day: keep(limits.seven_day), updated: Date.now() }));
      fs.renameSync(`${file}.tmp`, file);
    } catch {
      // The footer still shows them.
    }
  }
  const parts = [data.model?.display_name];
  if (data.context_window?.used_percentage != null) parts.push(`context ${Math.round(data.context_window.used_percentage)}%`);
  if (limits.five_hour?.used_percentage != null) parts.push(`session ${Math.round(limits.five_hour.used_percentage)}%`);
  if (limits.seven_day?.used_percentage != null) parts.push(`week ${Math.round(limits.seven_day.used_percentage)}%`);
  process.stdout.write(parts.filter(Boolean).join(" · "));
});
