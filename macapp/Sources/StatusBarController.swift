import Cocoa
import ServiceManagement

class StatusBarController: NSObject, NSMenuDelegate {
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
    private var copyNowPlayingItem: NSMenuItem!
    private var loginItem: NSMenuItem!
    private var isPausedState = false
    private var connectionState: ConnectionStatus = .disconnected

    init(nodeProcessManager: NodeProcessManager, logWindowController: LogWindowController) {
        self.nodeProcessManager = nodeProcessManager
        self.logWindowController = logWindowController
        super.init()
        setupStatusItem()
        setupNowPlayingObserver()
    }

    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        if let button = statusItem.button {
            if let image = NSImage(systemSymbolName: "play.circle", accessibilityDescription: "Jellyfin MPV Play") {
                image.isTemplate = true
                button.image = image
            }
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

        copyNowPlayingItem = NSMenuItem(title: "Copy Now Playing", action: #selector(copyNowPlaying), keyEquivalent: "c")
        copyNowPlayingItem.target = self
        copyNowPlayingItem.isEnabled = false
        menu.addItem(copyNowPlayingItem)

        menu.addItem(.separator())

        let showLogsItem = NSMenuItem(title: "Show Logs", action: #selector(showLogs), keyEquivalent: "l")
        showLogsItem.target = self
        menu.addItem(showLogsItem)

        let copyLogItem = NSMenuItem(title: "Copy Log to Clipboard", action: #selector(copyLog), keyEquivalent: "C")
        copyLogItem.target = self
        menu.addItem(copyLogItem)

        let preferencesItem = NSMenuItem(title: "Settings\u{2026}", action: #selector(showPreferences), keyEquivalent: ",")
        preferencesItem.target = self
        menu.addItem(preferencesItem)

        let aboutItem = NSMenuItem(title: "About Jellyfin MPV Play", action: #selector(showAbout), keyEquivalent: "i")
        aboutItem.target = self
        menu.addItem(aboutItem)

        let helpItem = NSMenuItem(title: "Help", action: #selector(showHelp), keyEquivalent: "/")
        helpItem.target = self
        menu.addItem(helpItem)

        menu.addItem(.separator())

        loginItem = NSMenuItem(title: "Open at Login", action: #selector(toggleOpenAtLogin), keyEquivalent: "")
        loginItem.target = self
        loginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(loginItem)

        menu.delegate = self

        let openConfigItem = NSMenuItem(title: "Open Config File", action: #selector(openConfigFile), keyEquivalent: "")
        openConfigItem.target = self
        menu.addItem(openConfigItem)

        let openAppSupportItem = NSMenuItem(title: "Open App Folder", action: #selector(openAppFolder), keyEquivalent: "")
        openAppSupportItem.target = self
        menu.addItem(openAppSupportItem)

        menu.addItem(.separator())

        let restartItem = NSMenuItem(title: "Restart", action: #selector(restart), keyEquivalent: "r")
        restartItem.target = self
        menu.addItem(restartItem)

        menu.addItem(.separator())

        let quitItem = NSMenuItem(title: "Quit Jellyfin MPV Play", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    private func setupNowPlayingObserver() {
        nodeProcessManager.nowPlayingHandler = { [weak self] title in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if title != self.nowPlaying {
                    // A different item started: drop any stale paused state
                    // (same behavior as the original updateNowPlaying).
                    self.isPausedState = false
                }
                self.nowPlaying = title
                if title == nil { self.isPausedState = false }
                self.render()
            }
        }
        nodeProcessManager.pauseStateHandler = { [weak self] isPaused in
            DispatchQueue.main.async {
                self?.isPausedState = isPaused
                self?.render()
            }
        }
    }

    // Single render path: icon, tooltip and menu rows all derive from the same
    // state, so they can never disagree (previously updateStatus(.playing)
    // overwrote the title tooltip with a generic "Playing").
    private func render() {
        let title = nowPlaying
        pauseItem.title = isPausedState ? "Resume" : "Pause"
        let playing = title != nil
        pauseItem.isEnabled = playing
        stopItem.isEnabled = playing
        copyNowPlayingItem.isEnabled = playing

        switch (connectionState, title) {
        case (_, .some(let title)):
            nowPlayingItem.title = isPausedState ? "Paused — \(title)" : title
            if isPausedState {
                setStatusIcon("pause.circle.fill", color: .systemOrange,
                              tooltip: "Jellyfin MPV Play — Paused — \(title)")
            } else {
                setStatusIcon("play.circle.fill", color: .systemOrange,
                              tooltip: "Jellyfin MPV Play — \(title)")
            }
        case (.connected, nil):
            nowPlayingItem.title = "Not playing"
            setStatusIcon("checkmark.circle", color: .systemGreen, tooltip: "Jellyfin MPV Play — Connected")
        case (.playing, nil):
            nowPlayingItem.title = "Not playing"
            setStatusIcon("play.circle.fill", color: .systemOrange, tooltip: "Jellyfin MPV Play — Playing")
        case (.disconnected, nil):
            nowPlayingItem.title = "Not playing"
            setStatusIcon("circle", color: .systemGray, tooltip: "Jellyfin MPV Play — Disconnected")
        }
    }

    private var nowPlaying: String?

    private func updateNowPlaying(_ title: String?) {
        nowPlaying = title
        if title == nil { isPausedState = false }
        render()
    }

    func updateStatus(_ status: ConnectionStatus) {
        connectionState = status
        render()
    }

    private func setStatusIcon(_ symbolName: String, color: NSColor, tooltip: String) {
        guard let button = statusItem.button else { return }
        let config = NSImage.SymbolConfiguration(paletteColors: [color])
        if let image = NSImage(systemSymbolName: symbolName, accessibilityDescription: tooltip)?.withSymbolConfiguration(config) {
            button.image = image
        }
        button.toolTip = tooltip
    }

    private func showAndActivate(_ controller: NSWindowController) {
        controller.showWindow(nil)
        controller.window?.makeKeyAndOrderFront(nil)
        if #available(macOS 14.0, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    func menuWillOpen(_ menu: NSMenu) {
        updateLoginItemState()
    }

    // SMAppService has a third state: .requiresApproval (macOS 13 Login Items).
    // Showing "off" there hides that the toggle is pending user approval.
    private func updateLoginItemState() {
        switch SMAppService.mainApp.status {
        case .enabled:
            loginItem.state = .on
            loginItem.title = "Open at Login"
        case .requiresApproval:
            loginItem.state = .off
            loginItem.title = "Open at Login — Waiting for Approval…"
        default:
            loginItem.state = .off
            loginItem.title = "Open at Login"
        }
    }

    @objc private func togglePause() {
        guard nodeProcessManager.isPlaying else { return }
        nodeProcessManager.togglePause()
        // Don't toggle local state here — it's updated by pauseStateHandler callback from processLogLine
    }

    @objc private func stopPlayback() {
        nodeProcessManager.stopPlayback()
        isPausedState = false
        updateNowPlaying(nil)
    }

    @objc func showLogs() {
        showAndActivate(logWindowController)
    }

    @objc private func copyLog() {
        logWindowController.copyFullLog()
    }

    @objc func showPreferences() {
        if preferencesWindowController == nil {
            preferencesWindowController = PreferencesWindowController()
            preferencesWindowController?.onSave = { [weak self] in
                self?.nodeProcessManager.stop {
                    DispatchQueue.main.async {
                        self?.nodeProcessManager.start()
                    }
                }
            }
        }
        if let controller = preferencesWindowController {
            showAndActivate(controller)
        }
    }

    @objc func showAbout() {
        if aboutWindowController == nil {
            aboutWindowController = AboutWindowController()
        }
        if let controller = aboutWindowController {
            showAndActivate(controller)
        }
    }

    @objc func showHelp() {
        if helpWindowController == nil {
            helpWindowController = HelpWindowController()
        }
        if let controller = helpWindowController {
            showAndActivate(controller)
        }
    }

    @objc private func copyNowPlaying() {
        if let title = nodeProcessManager.nowPlaying {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(title, forType: .string)
        }
    }

    @objc private func toggleOpenAtLogin() {
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
            updateLoginItemState()
            if SMAppService.mainApp.status == .requiresApproval {
                // The user must approve in System Settings > General > Login Items
                SMAppService.openSystemSettingsLoginItems()
            }
        } catch {
            // Revert the checkbox state on error
            updateLoginItemState()
            let alert = NSAlert()
            alert.messageText = "Failed to update login item"
            alert.informativeText = error.localizedDescription
            alert.alertStyle = .warning
            alert.addButton(withTitle: "OK")
            alert.runModal()
        }
    }

    @objc private func openConfigFile() {
        let configPath = ConfigParser.configPath()
        if FileManager.default.fileExists(atPath: configPath) {
            NSWorkspace.shared.open(URL(fileURLWithPath: configPath))
        } else {
            let alert = NSAlert()
            alert.messageText = "Config file not found"
            alert.informativeText = "No config.js found at:\n\(configPath)"
            alert.alertStyle = .warning
            alert.addButton(withTitle: "OK")
            alert.runModal()
        }
    }

    @objc private func openAppFolder() {
        let folderPath = ConfigParser.applicationSupportDir()
        if FileManager.default.fileExists(atPath: folderPath) {
            NSWorkspace.shared.open(URL(fileURLWithPath: folderPath))
        } else {
            let alert = NSAlert()
            alert.messageText = "App folder not found"
            alert.informativeText = "No folder found at:\n\(folderPath)"
            alert.alertStyle = .warning
            alert.addButton(withTitle: "OK")
            alert.runModal()
        }
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
