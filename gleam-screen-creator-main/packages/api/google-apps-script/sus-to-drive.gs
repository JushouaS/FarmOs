/**
 * Saves each "Report a problem" note (problem_reports.csv) and each SUS
 * questionnaire response (sus_responses.csv) as a line in a .csv file in YOUR
 * Google Drive. Deployed as a Web app that runs as you, it is the only thing
 * that can write to your Drive; the FarmOS API calls it with a shared token.
 *
 * Setup (about 3 minutes):
 *   1. Go to https://script.google.com, signed in to the Google account that
 *      should own the file, and click "New project". Paste this whole file in
 *      place of the starter code and save.
 *   2. Project Settings (gear icon) > Script Properties > Add:
 *        TOKEN      any long random string, at least 16 characters
 *        FOLDER_ID  (optional) the id of a Drive folder for the file; leave it
 *                   out to use the top level of My Drive
 *   3. Deploy > New deployment > type "Web app":
 *        Execute as       Me
 *        Who has access   Anyone
 *      Approve the permission prompt, then copy the Web app URL.
 *   4. In packages/api/.env set
 *        SUS_GOOGLE_SCRIPT_URL=<the Web app URL>
 *        SUS_GOOGLE_SCRIPT_TOKEN=<the same TOKEN value>
 *      and restart the API.
 *
 * "Anyone" only means the URL can be reached without a Google sign-in. Every
 * request must still carry the TOKEN, or it is refused and nothing is written.
 * After editing this file later, use Deploy > Manage deployments > Edit > New
 * version, so the same URL keeps working.
 */

// The two forms each have their own file. Anything else is refused.
var ALLOWED_FILES = ["sus_responses.csv", "problem_reports.csv"];

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var props = PropertiesService.getScriptProperties();
    var expected = props.getProperty("TOKEN");
    var body = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    if (!expected || expected.length < 16 || body.token !== expected) {
      return json_({ ok: false, error: "unauthorized" });
    }
    if (ALLOWED_FILES.indexOf(body.file) === -1 || !Array.isArray(body.row) || !Array.isArray(body.header)) {
      return json_({ ok: false, error: "bad_request" });
    }

    // One writer at a time so two responses cannot overwrite each other.
    lock.waitLock(20000);

    var file = findFile_(props.getProperty("FOLDER_ID"), body.file);
    if (!file) {
      file = createFile_(props.getProperty("FOLDER_ID"), body.file, csvLine_(body.header));
    }
    file.setContent(file.getBlob().getDataAsString("UTF-8") + csvLine_(body.row));
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

function folder_(folderId) {
  return folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder();
}

function findFile_(folderId, name) {
  var files = folder_(folderId).getFilesByName(name);
  while (files.hasNext()) {
    var f = files.next();
    if (!f.isTrashed()) return f;
  }
  return null;
}

function createFile_(folderId, name, headerLine) {
  // The leading BOM lets Excel read accented and non-Latin text correctly.
  return folder_(folderId).createFile(name, "﻿" + headerLine, "text/csv");
}

/** One quoted CSV line. Text that starts with = + - @ would run as a formula
 *  when the file is opened in Sheets or Excel, so it gets a leading apostrophe. */
function csvLine_(cells) {
  return cells.map(function (cell) {
    if (typeof cell === "number") return String(cell);
    var s = String(cell == null ? "" : cell);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }).join(",") + "\r\n";
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
