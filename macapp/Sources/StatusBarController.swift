import Cocoa

class StatusBarController {
    private var statusItem: NSStatusItem!
    private var nodeProcessManager: NodeProcessManager
    private var logWindowController: LogWindowController
    private var preferencesWindowController: PreferencesWindowController?
    private var aboutWindowController: AboutWindowController?
    private var helpWindowController: HelpWindowController?
    private var menu: NSMenu!
    private var nowPlayingItem: NSMenuItem!
    private var pauseItem: NSMenuItem!
    private var stopItem: NSMenuItem!
    private var isPausedState = false

    init(nodeProcessManager: NodeProcessManager, logWindowController: LogWindowController) {
        self.nodeProcessManager = nodeProcessManager
        self.logWindowController = logWindowController
        setupStatusItem()
        setupNowPlayingObserver()
    }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "play.circle", accessibilityDescription: "Jellyfin MPV Play")
            button.contentTintColor = .white
        }

        menu = NSMenu()
        menu.autoenablesItems = false

        nowPlayingItem = NSMenuItem(title: "Not playing", action: nil, keyEquivalent: "")
        nowPlayingItem.isEnabled = false
        menu.addItem(nowPlayingItem)

        menu.addItem(.separator())

        pauseItem = NSMenuItem(title: "Pause", action: #selector(togglePause), keyEquivalent: "p")
        pauseItem.target = self
        pauseItem.isEnabled = false
        menu.addItem(pauseItem)

        stopItem = NSMenuItem(title: "Stop", action: #selector(stopPlayback), keyEquivalent: ".")
        stopItem.target = self
        stopItem.isEnabled = false
        menu.addItem(stopItem)

        menu.addItem(.separator())

        let showLogsItem = NSMenuItem(title: "Show Logs", action: #selector(showLogs), keyEquivalent: "l")
        showLogsItem.target = self
        menu.addItem(showLogsItem)

        let preferencesItem = NSMenuItem(title: "Preferences", action: #selector(showPreferences), keyEquivalent: ",")
        preferencesItem.target = self
        menu.addItem(preferencesItem)

        let aboutItem = NSMenuItem(title: "About", action: #selector(showAbout), keyEquivalent: "")
        aboutItem.target = self
        menu.addItem(aboutItem)

        let helpItem = NSMenuItem(title: "Help", action: #selector(showHelp), keyEquivalent: "?")
        helpItem.target = self
        menu.addItem(helpItem)

        menu.addItem(.separator())

        let restartItem = NSMenuItem(title: "Restart", action: #selector(restart), keyEquivalent: "r")
        restartItem.target = self
        menu.addItem(restartItem)

        menu.addItem(.separator())

        let quitItem = NSMenuItem(title: "Quit", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    private func setupNowPlayingObserver() {
        nodeProcessManager.nowPlayingHandler = { [weak self] title in
            DispatchQueue.main.async {
                self?.updateNowPlaying(title)
            }
        }
    }

    private func updateNowPlaying(_ title: String?) {
        if let title = title {
            nowPlayingItem.title = "\u{25B6} \(title)"
            pauseItem.isEnabled = true
            stopItem.isEnabled = true
            pauseItem.title = "Pause"
            setStatusIcon("play.circle.fill", color: .systemOrange, tooltip: "Jellyfin MPV Play — \(title)")
        } else {
            nowPlayingItem.title = "Not playing"
            pauseItem.isEnabled = false
            stopItem.isEnabled = false
            pauseItem.title = "Pause"
            isPausedState = false
            setStatusIcon("checkmark.circle", color: .systemGreen, tooltip: "Jellyfin MPV Play — Connected")
        }
    }

    func updateStatus(_ status: ConnectionStatus) {
        switch status {
        case .disconnected:
            setStatusIcon("circle", color: .systemGray, tooltip: "Jellyfin MPV Play — Disconnected")
        case .connected:
            if nodeProcessManager.nowPlaying == nil {
                setStatusIcon("checkmark.circle", color: .systemGreen, tooltip: "Jellyfin MPV Play — Connected")
            }
        case .playing:
            setStatusIcon("play.circle.fill", color: .systemOrange, tooltip: "Jellyfin MPV Play — Playing")
        }
    }

    private func setStatusIcon(_ symbolName: String, color: NSColor, tooltip: String) {
        guard let button = statusItem.button else { return }
        if let image = NSImage(systemSymbolName: symbolName, accessibilityDescription: nil) {
            image.isTemplate = false
            button.image = image
        }
        button.contentTintColor = color
        button.toolTip = tooltip
    }

    @objc private func togglePause() {
        guard nodeProcessManager.isPlaying else { return }
        nodeProcessManager.togglePause()
        isPausedState.toggle()
        pauseItem.title = isPausedState ? "Resume" : "Pause"
    }

    @objc private func stopPlayback() {
        nodeProcessManager.stopPlayback()
        isPausedState = false
        updateNowPlaying(nil)
    }

    @objc private func showLogs() {
        logWindowController.showWindow(nil)
        logWindowController.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func showPreferences() {
        if preferencesWindowController == nil {
            preferencesWindowController = PreferencesWindowController()
        }
        preferencesWindowController?.showWindow(nil)
        preferencesWindowController?.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func showAbout() {
        if aboutWindowController == nil {
            aboutWindowController = AboutWindowController()
        }
        aboutWindowController?.showWindow(nil)
        aboutWindowController?.window?.makeKeyAndOrderFront(nil)
    }

    @objc private func showHelp() {
        if helpWindowController == nil {
            helpWindowController = HelpWindowController()
        }
        helpWindowController?.showWindow(nil)
        helpWindowController?.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func restart() {
        nodeProcessManager.stop { [weak self] in
            DispatchQueue.main.async {
                self?.nodeProcessManager.start()
            }
        }
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }
}
