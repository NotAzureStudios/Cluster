import { useId } from "react";
import { ClusterSettingsHelp } from "../../components/ClusterSettingsPrimitives";
import {
  NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_DETAILS, NOTIFICATION_DELIVERY_OPTIONS,
  type NotificationCategory, type NotificationDeliveryMode,
} from "./notification-preferences";
import "./cluster-notification-delivery-matrix.css";

export function ClusterNotificationDeliveryMatrix({
  value, onChange, nativePermissionReady,
}: {
  value: Readonly<Record<NotificationCategory, NotificationDeliveryMode>>;
  onChange: (category: NotificationCategory, mode: NotificationDeliveryMode) => void;
  nativePermissionReady: boolean;
}) {
  const id = useId();
  const activeCount = NOTIFICATION_CATEGORIES.filter((category) => value[category] !== "off").length;
  return <div className="cluster-notification-matrix-v11">
    <div className="cluster-notification-matrix-heading-v11">
      <div>
        <div className="cluster-notification-matrix-title-v11">
          <strong>Delivery by category</strong>
          <ClusterSettingsHelp label="delivery modes">
            {NOTIFICATION_DELIVERY_OPTIONS.map((option) => <p key={option.value}><b>{option.label}:</b> {option.detail}</p>)}
          </ClusterSettingsHelp>
        </div>
        <span>Choose where updates appear. Your inbox remains the record for every mode except Off.</span>
      </div>
      <small>{activeCount}/{NOTIFICATION_CATEGORIES.length} active</small>
    </div>
    {!nativePermissionReady && <p className="cluster-notification-matrix-warning-v11" role="note">
      Native delivery can be selected, but requires device notification permission to display system alerts.
    </p>}
    <div className="cluster-notification-matrix-scroll-v11" role="region" tabIndex={0} aria-label="Notification delivery settings, scroll horizontally for all choices">
      <table>
        <thead>
          <tr>
            <th scope="col">Category</th>
            {NOTIFICATION_DELIVERY_OPTIONS.map((option) => <th key={option.value} scope="col">
              <span title={option.detail}>{option.label}</span>
            </th>)}
          </tr>
        </thead>
        <tbody>
          {NOTIFICATION_CATEGORIES.map((category) => {
            const detail = NOTIFICATION_CATEGORY_DETAILS[category];
            return <tr key={category} data-delivery={value[category]}>
              <th scope="row">
                <div className="cluster-notification-matrix-category-v11">
                  <strong title={detail.description}>{detail.label}</strong>
                  <span id={id + "-desc-" + category} className="cluster-notification-matrix-sr-only-v11">{detail.description}</span>
                </div>
              </th>
              {NOTIFICATION_DELIVERY_OPTIONS.map((option) => <td key={option.value}>
                <label className="cluster-notification-matrix-cell-v11">
                  <input
                    type="radio" name={id + "-" + category}
                    checked={value[category] === option.value}
                    onChange={() => onChange(category, option.value)}
                    aria-label={detail.label + ": " + option.label}
                    aria-describedby={id + "-desc-" + category}
                  />
                  <span aria-hidden="true" />
                </label>
              </td>)}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    <p className="cluster-notification-matrix-footnote-v11">Silent: inbox only. Off: hide category from inbox and unread count. System and security protections remain server-enforced.</p>
  </div>;
}
