#include "../src/DesktopDirectDownloadPolicy.h"
#include <cassert>
#include <iostream>
using cluster::desktop::directdownload::Decision;
using cluster::desktop::directdownload::admit;
int main()
{
    int assertions = 0;
    const auto check = [&assertions](bool ok) { assert(ok); ++assertions; };
    check(admit(200, false, false, 1024, 1024) == Decision::accept);
    check(admit(200, false, false, 10) == Decision::accept);
    check(admit(200, false, false, 0, 0) == Decision::accept);
    check(admit(206, false, false, 1024, 1024) == Decision::rejectedStatus);
    check(admit(302, false, false, 10, 10) == Decision::rejectedStatus);
    check(admit(401, false, false, 10, 10) == Decision::rejectedStatus);
    check(admit(200, true, false, 10, 10) == Decision::interrupted);
    check(admit(200, false, true, 10, 10) == Decision::writeError);
    check(admit(200, false, false, 5, 10) == Decision::invalidLength);
    check(admit(200, false, false, 12, 10) == Decision::invalidLength);
    check(admit(200, false, false, 12, -2) == Decision::invalidLength);
    check(admit(200, false, false, -1, -1) == Decision::invalidLength);
    std::cout << "PASS " << assertions << " native direct download policy assertions\n";
}
