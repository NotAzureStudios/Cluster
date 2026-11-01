# RC47 Windows test checklist

1. Keep your last working Cluster Server folder and PostgreSQL data intact. Run `Cluster-Installer-RC47-STABILIZATION-TEST.exe` from a writable Windows folder. The installer should stage and compile the embedded source without swapping out the running server unless all build steps succeed.
2. Start the new `Cluster Server.exe`. Confirm that PostgreSQL 18.6 initializes or reuses its data, the schema check completes, and `http://localhost:3000` loads.
3. On a desktop-width browser, collapse the sidebar. Verify its expand arrow remains visible, the page remains beside the 72-pixel icon rail rather than jumping below it, and clicking the arrow immediately expands. Reload and repeat. At a phone-width viewport, verify the drawer still opens full-width and closes normally.
4. Hover different sidebar destinations without clicking and inspect the browser Network tab. Hover alone should not fire API reads; selecting a page should still load its data. Reload a page after a transient slow connection and confirm module imports can retry.
5. Open People, open your profile and a second account, switch rapidly, and verify the identity always matches the selected user. The profile header should be available before the Team and workforce analytics finish. Check that empty optional profile fields do not show repeated Unset boxes, but Full Profile still contains edit/access details.
6. Regression check Whiteboard: blank new board, pen, brush eraser (partial rather than whole stroke), separate object erase. Check Board close returns to the originating page, not always Projects.
7. Check Studio Settings → Departments icons, Discord bot management (without enabling role sync by default), and Server Configuration connection guide.
8. Capture the first failing operation and `D:\Cluster-Server\Cluster\installer.log` or native Server logs if any errors remain.

**Do not expose ports 4000 (private API), 54321 (PostgreSQL) or the host's router management interface to the public Internet.** A Tunnel or private VPN needs an explicit separate reachability and authentication check. The wizard's network choice is informational until configured.
