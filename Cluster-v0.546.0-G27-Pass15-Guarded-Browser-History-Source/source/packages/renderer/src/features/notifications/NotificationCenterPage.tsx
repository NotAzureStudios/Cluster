import { NotificationInboxPage } from "./NotificationInboxPage";
import "./notifications.css";

/** Semantic notifications route. The inbox is the single notification UI owner. */
export function NotificationCenterPage(props: Parameters<typeof NotificationInboxPage>[0]) {
  return <NotificationInboxPage {...props} />;
}
