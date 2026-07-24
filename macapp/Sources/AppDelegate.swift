import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusBarController: StatusBarController!
    var nodeProcessManager: NodeProcessManager!
    var logWindowController: LogWindowController!
    var notificationManager: NotificationManager!
    private var preferencesWindowController: PreferencesWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        logWindowController = LogWindowController()
        notificationManager = NotificationManager()

        nodeProcessManager = NodeProcessManager(
            logHandler: { [weak self] line in
                DispatchQueue.main.async {
                    self?.logWindowController.appendLog(line)
                }
            },
            statusHandler: { [weak self] status in
                DispatchQueue.main.async {
                    self?.statusBarController?.updateStatus(status)
                }
            },
            notificationHandler: { [weak self] title, message in
                DispatchQueue.main.async {
                    self?.notificationManager.showNotification(title: title, message: message)
                }
            },
            nowPlayingHandler: nil
        )

        statusBarController = StatusBarController(nodeProcessManager: nodeProcessManager, logWindowController: logWindowController)
        nodeProcessManager.statusHandler = { status in
            DispatchQueue.main.async {
                self.statusBarController.updateStatus(status)
            }
        }

        if needsSetup() {
            showSetup()
        } else {
            nodeProcessManager.start()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        nodeProcessManager.stop()
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if nodeProcessManager.isPlaying {
            let alert = NSAlert()
            alert.messageText = "MPV is still playing"
            alert.informativeText = "Are you sure you want to quit?"
            alert.alertStyle = .warning
            alert.addButton(withTitle: "Quit")
            alert.addButton(withTitle: "Cancel")
            let response = alert.runModal()
            if response == .alertSecondButtonReturn {
                return .terminateCancel
            }
        }
        return .terminateNow
    }

    private func needsSetup() -> Bool {
        let appSupport = NSSearchPathForDirectoriesInDomains(.applicationSupportDirectory, .userDomainMask, true).first ?? ""
        let configPath = (appSupport as NSString).appendingPathComponent("JellyfinMpvPlay/config.js")

        guard let content = try? String(contentsOfFile: configPath, encoding: .utf8) else {
            return true
        }

        let defaults = ["YOUR_JELLYFIN_IP", "your_username", "your_password", "C:\\\\path\\\\to\\\\mpv.exe", "My-MPV-Player", "My-MPV-room"]
        for d in defaults {
            if content.contains(d) {
                return true
            }
        }
        return false
    }

    private func showSetup() {
        let prefs = PreferencesWindowController()
        prefs.onSave = { [weak self] in
            self?.nodeProcessManager.start()
        }
        prefs.showWindow(nil)
        prefs.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        preferencesWindowController = prefs
    }
}
