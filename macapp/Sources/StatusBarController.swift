import Cocoa
import ServiceManagement

class StatusBarController: NSObject {
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

        let preferencesItem = NSMenuItem(title: "Preferences", action: #selector(showPreferences), keyEquivalent: ",")
        preferencesItem.target = self
        menu.addItem(preferencesItem)

        let aboutItem = NSMenuItem(title: "About", action: #selector(showAbout), keyEquivalent: "i")
        aboutItem.target = self
        menu.addItem(aboutItem)

        let helpItem = NSMenuItem(title: "Help", action: #selector(showHelp), keyEquivalent: "/")
        helpItem.target = self
        menu.addItem(helpItem)

        menu.addItem(.separator())

        let loginItem = NSMenuItem(title: "Open at Login", action: #selector(toggleOpenAtLogin), keyEquivalent: "")
        loginItem.target = self
        loginItem.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(loginItem)

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
        nodeProcessManager.pauseStateHandler = { [weak self] isPaused in
            DispatchQueue.main.async {
                self?.isPausedState = isPaused
                self?.pauseItem.title = isPaused ? "Resume" : "Pause"
            }
        }
    }

    private func updateNowPlaying(_ title: String?) {
        if let title = title {
            nowPlayingItem.title = "\u{25B6} \(title)"
            pauseItem.isEnabled = true
            stopItem.isEnabled = true
            copyNowPlayingItem.isEnabled = true
            // Reset pause state for new playback
            isPausedState = false
            pauseItem.title = "Pause"
            setStatusIcon("play.circle.fill", color: .systemOrange, tooltip: "Jellyfin MPV Play — \(title)")
        } else {
            nowPlayingItem.title = "Not playing"
            pauseItem.isEnabled = false
            stopItem.isEnabled = false
            copyNowPlayingItem.isEnabled = false
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
        if let image = NSImage(systemSymbolName: symbolName, accessibilityDescription: tooltip) {
            image.isTemplate = true
            button.image = image
        }
        button.contentTintColor = color
        button.toolTip = tooltip
    }

    @objc private func togglePause() {
        guard nodeProcessManager.isPlaying else { return }
        nodeProcessManager.togglePause()
        // Don't toggle local state here — it's updated by pauseStateHandler callback from processLogLine
    }

    @objc private func stopPlayback() {
        nodeProcessManager.stopPlayback()
        isPausedState = false
        pauseItem.title = "Pause"
        updateNowPlaying(nil)
    }

    @objc private func showLogs() {
        logWindowController.showWindow(nil)
        logWindowController.window?.makeKeyAndOrderFront(nil)
        if #available(macOS 14.0, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    @objc private func showPreferences() {
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
        preferencesWindowController?.showWindow(nil)
        preferencesWindowController?.window?.makeKeyAndOrderFront(nil)
        if #available(macOS 14.0, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    @objc private func showAbout() {
        if aboutWindowController == nil {
            aboutWindowController = AboutWindowController()
        }
        aboutWindowController?.showWindow(nil)
        aboutWindowController?.window?.makeKeyAndOrderFront(nil)
        if #available(macOS 14.0, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    @objc private func showHelp() {
        if helpWindowController == nil {
            helpWindowController = HelpWindowController()
        }
        helpWindowController?.showWindow(nil)
        helpWindowController?.window?.makeKeyAndOrderFront(nil)
        if #available(macOS 14.0, *) {
            NSApp.activate()
        } else {
            NSApp.activate(ignoringOtherApps: true)
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
            menu.items.first { $0.title == "Open at Login" }?.state =
                SMAppService.mainApp.status == .enabled ? .on : .off
        } catch {
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
