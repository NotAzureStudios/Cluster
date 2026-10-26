# UX G26 WS7 | Required Packet reminders

The manager can see a release's assigned recipients, acknowledgment state, optional due date, last committed reminder timestamp, and one explicit **Send reminder** action per outstanding assignment. Do not show an automated sending indicator. The action is disabled for seven rolling days after a committed reminder and for acknowledged or withdrawn releases; the server is authoritative and replies with actionable 409 states when data changes in another window.

Recipient Inbox items say only that a published Packet requires acknowledgment and link by packet resource identity. They do not expose private titles, publication source IDs, files, or manifest contents. Packet itself is reopened through ordinary authorization; historical reminder notices do not grant access. A notification means an inbox item was issued, not that someone downloaded, read or accepted the release. Existing recipient-side confirmation remains the sole explicit acknowledgment mechanism.

No new global polling, prominent UI banner, nested settings page or parallel reminders workspace. Preserve compact on-demand surfaces, density and keyboard accessibility.
