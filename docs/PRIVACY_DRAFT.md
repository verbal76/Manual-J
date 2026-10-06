# Privacy facts (DRAFT for owner/legal review — not a legal document)
- The app has no accounts, ads, analytics or crash reporting, and requests only the Android INTERNET permission.
- Project information you enter (project name, client name, address, house measurements, results) is stored only on your device in the app's local storage. The app does not upload it.
- If you use Share/Save report, the report goes where you choose.
- If update checks are enabled in a build, the app makes an HTTPS request to the update server to read a small manifest and, when an update exists, download it. The server operator can see your IP address and standard request metadata. No project data is sent.
- Uninstalling the app deletes its local data. There is no server-side copy to delete.
- Note for review: Android Auto Backup is currently allowed (`allowBackup=true`), so the operating system may include the app's local data in the user's own device backup. Decide whether to disable it before claiming data never leaves the device.
