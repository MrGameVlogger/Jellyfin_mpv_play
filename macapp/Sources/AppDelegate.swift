import Cocoa

class AppDelegate: NSObject, NSApplicationDelegate {
    var statusBarController: StatusBarController!
    var nodeProcessManager: NodeProcessManager!
    var logWindowController: LogWindowController!
    var notificationManager: NotificationManager!
    private var setupWindowController: SetupWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        installMainMenu()
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

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool {
        true
    }

    // HIG: every Mac app has a main menu. This restores the standard app/window/
    // help behavior (Cmd+Q, Cmd+W, Cmd+H, Cmd+?, Cmd+,) that was previously
    // unavailable anywhere in the app.
    private func installMainMenu() {
        let mainMenu = NSMenu()

        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        appMenu.addItem(withTitle: "About Jellyfin MPV Play", action: #selector(showAbout), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Settings\u{2026}", action: #selector(showSettings), keyEquivalent: ",")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Jellyfin MPV Play", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Jellyfin MPV Play", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let windowItem = NSMenuItem()
        mainMenu.addItem(windowItem)
        let windowMenu = NSMenu(title: "Window")
        windowItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(.separator())
        windowMenu.addItem(withTitle: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        NSApp.windowsMenu = windowMenu

        let helpItem = NSMenuItem()
        mainMenu.addItem(helpItem)
        let helpMenu = NSMenu(title: "Help")
        helpItem.submenu = helpMenu
        helpMenu.addItem(withTitle: "Jellyfin MPV Play Help", action: #selector(showHelp), keyEquivalent: "?")
        NSApp.helpMenu = helpMenu

        NSApp.mainMenu = mainMenu
    }

    // Main-menu actions (the responder chain lands on the delegate); the windows
    // themselves are owned by the status bar controller.
    @objc private func showAbout() {
        statusBarController.showAbout()
    }

    @objc private func showSettings() {
        statusBarController.showPreferences()
    }

    @objc private func showHelp() {
        statusBarController.showHelp()
    }

    func applicationWillTerminate(_ notification: Notification) {
        // Cleanup happens asynchronously in applicationShouldTerminate via
        // .terminateLater — nothing to do here.
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if nodeProcessManager.isPlaying {
            let alert = NSAlert()
            alert.messageText = "Quit while MPV is still playing?"
            alert.informativeText = "Playback will stop and MPV will close."
            alert.alertStyle = .warning
            alert.addButton(withTitle: "Cancel")
            alert.addButton(withTitle: "Quit")
            alert.buttons.first?.keyEquivalent = "\r"
            alert.buttons.last?.keyEquivalent = "q"
            let response = alert.runModal()
            if response == .alertFirstButtonReturn {
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
