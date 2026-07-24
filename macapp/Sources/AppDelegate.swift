import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusBarController: StatusBarController!
    var nodeProcessManager: NodeProcessManager!
    var logWindowController: LogWindowController!
    var notificationManager: NotificationManager!

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

        nodeProcessManager.start()
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
}
