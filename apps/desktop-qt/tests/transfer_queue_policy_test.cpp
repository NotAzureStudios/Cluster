#include "../src/DesktopTransferQueuePolicy.h"
#include <cassert>
#include <iostream>
using namespace cluster::desktop::transfer;

int main()
{
    int passed = 0;
    const auto check = [&passed](bool ok) { assert(ok); ++passed; };
    check(admissionLimit == 200);
    check(mayAdmit(0));
    check(mayAdmit(1));
    check(mayAdmit(199));
    check(!mayAdmit(200));
    check(!mayAdmit(201));
    check(!mayAdmit(1000));
    check(historyEvictable("complete"));
    check(historyEvictable("cancelled"));
    check(!historyEvictable("running"));
    check(!historyEvictable("queued"));
    check(!historyEvictable("paused"));
    check(!historyEvictable("verifying"));
    check(!historyEvictable("failed"));
    check(!historyEvictable(""));
    check(!historyEvictable("COMPLETE"));
    std::cout << "PASS " << passed << " native queue-retention policy assertions\n";
}
