import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusBarController: StatusBarController!
    var nodeProcessManager: NodeProcessManager!
    var logWindowController: LogWindowController!
    var notificationManager: NotificationManager!
    private var setupWindowController: SetupWindowController?

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
        nodeProcessManager.statusHandler = { [weak self] status in
            DispatchQueue.main.async {
                self?.statusBarController.updateStatus(status)
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

        let hasServer = extractConfigValue(content, key: "serverUrl").isEmpty == false
        let hasUser = extractConfigValue(content, key: "username").isEmpty == false
        let hasPass = extractConfigValue(content, key: "password").isEmpty == false

        return !hasServer || !hasUser || !hasPass
    }

    private func extractConfigValue(_ content: String, key: String) -> String {
        let escapedKey = NSRegularExpression.escapedPattern(for: key)
        let pattern = "\(escapedKey):\\s*['\"]([^'\\\"]*(?:\\\\.[^'\\\"]*)*)['\"]"
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: content, range: NSRange(content.startIndex..., in: content)),
              let range = Range(match.range(at: 1), in: content) else {
            return ""
        }
        return String(content[range]).trimmingCharacters(in: .whitespaces)
    }

    private func showSetup() {
        let setup = SetupWindowController { [weak self] in
            self?.nodeProcessManager.start()
        }
        setup.showWindow(nil)
        setup.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        setupWindowController = setup
    }
}
