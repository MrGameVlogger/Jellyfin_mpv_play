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
            statusHandler: { _ in },
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
        // Cleanup happens asynchronously in applicationShouldTerminate via
        // .terminateLater — nothing to do here.
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
        // Terminate asynchronously: stop() needs to report playback stop to the
        // server and clean up the IPC socket. (The old Thread.sleep here blocked
        // the main thread, which prevented stop()s own callbacks from running.)
        nodeProcessManager.stop { [weak self] in
            DispatchQueue.main.async {
                self?.finishTerminate()
            }
        }
        // Safety net in case the child process hangs past the SIGKILL fallback
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            self?.finishTerminate()
        }
        return .terminateLater
    }

    private var terminateReplied = false
    private func finishTerminate() {
        guard !terminateReplied else { return }
        terminateReplied = true
        NSApp.reply(toApplicationShouldTerminate: true)
    }

    private func needsSetup() -> Bool {
        guard let content = ConfigParser.loadConfigContent() else {
            return true
        }

        let hasServer = ConfigParser.extractValue(from: content, key: "serverUrl").isEmpty == false
        let hasUser = ConfigParser.extractValue(from: content, key: "username").isEmpty == false
        let hasPass = ConfigParser.extractValue(from: content, key: "password").isEmpty == false

        return !hasServer || !hasUser || !hasPass
    }

    private func showSetup() {
        let setup = SetupWindowController { [weak self] in
            self?.nodeProcessManager.start()
        }
        setup.showWindow(nil)
        setup.window?.makeKeyAndOrderFront(nil)
        if #available(macOS 14.0, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
        setupWindowController = setup
    }
}
