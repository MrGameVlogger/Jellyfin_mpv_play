import Cocoa
import UserNotifications

class NotificationManager: NSObject, UNUserNotificationCenterDelegate {
    private let available: Bool

    override init() {
        // UNUserNotificationCenter.current() hard-crashes outside a bundled app
        // (running the raw binary from a terminal, unbundled debug builds) —
        // degrade to notifications-off instead of dying at launch.
        available = Bundle.main.bundleIdentifier != nil
        super.init()
        guard available else { return }
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, error in
            if !granted {
                NSLog("JellyfinMPVPlay: Notification permission denied")
            }
            if let error = error {
                NSLog("JellyfinMPVPlay: Notification authorization error: \(error)")
            }
        }
    }

    func showNotification(title: String, message: String) {
        guard available else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = message
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request) { _ in }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
}
