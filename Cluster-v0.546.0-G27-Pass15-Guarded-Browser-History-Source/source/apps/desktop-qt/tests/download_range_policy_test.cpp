#include "../src/DesktopDownloadRangePolicy.h"
#include <cassert>
#include <cstdint>
#include <iostream>
using namespace cluster::desktop::download;

int main() {
    int passed = 0;
    const auto check = [&passed](bool value) { assert(value); ++passed; };
    const auto good = admit(206, 100, 300, "bytes 100-299/300", "200", "\"generation\"", "\"generation\"");
    check(good.accepted()); check(good.total == 300); check(good.bodyLength == 200);
    check(admit(200, 0, 0, "", "300", "\"generation\"", "").accepted());
    check(admit(206, 0, 0, "bytes 0-99/300", "100", "", "").accepted());
    check(!admit(200, 100, 300, "", "300", "\"generation\"", "\"generation\"").accepted());
    check(admit(200, 100, 300, "", "300", "", "").rejection == Reject::ignoredResume);
    check(admit(206, 100, 300, "bytes 100-299/300", "200", "\"new\"", "\"old\"").rejection == Reject::changedGeneration);
    check(admit(206, 100, 300, "bytes 99-299/300", "201", "", "").rejection == Reject::mismatchedRange);
    check(admit(206, 100, 300, "bytes 101-299/300", "199", "", "").rejection == Reject::mismatchedRange);
    check(admit(206, 100, 300, "bytes 100-300/300", "201", "", "").rejection == Reject::mismatchedRange);
    check(admit(206, 100, 300, "bytes 100-299/301", "200", "", "").rejection == Reject::mismatchedRange);
    check(admit(206, 100, 300, "bytes 100-299/300", "199", "", "").rejection == Reject::invalidLength);
    check(admit(206, 100, 300, "bytes 100-299/300", "201", "", "").rejection == Reject::invalidLength);
    check(admit(206, 100, 300, "bytes 100-299/*", "200", "", "").rejection == Reject::invalidRange);
    check(admit(206, 100, 300, "bytes 100-299/300, bytes 0-99/300", "", "", "").rejection == Reject::invalidRange);
    check(admit(206, 100, 300, "bytes 100-299/300/400", "", "", "").rejection == Reject::invalidRange);
    check(admit(206, 100, 300, "bytes 100-299/9223372036854775808", "", "", "").rejection == Reject::invalidRange);
    check(admit(206, 100, 300, "bytes 100-299/300", "-4", "", "").rejection == Reject::invalidLength);
    check(admit(206, 100, 300, "bytes 100-299/300", "0", "", "").rejection == Reject::invalidLength);
    check(admit(206, 100, 300, "bytes 100-299/300", "200x", "", "").rejection == Reject::invalidLength);
    check(admit(200, 0, 0, "", "", "", "").rejection == Reject::missingTotal);
    check(admit(503, 100, 300, "", "", "", "").rejection == Reject::invalidStatus);
    check(admit(401, 100, 300, "", "", "", "").rejection == Reject::invalidStatus);
    check(admit(206, 300, 300, "bytes 300-399/400", "100", "", "").rejection == Reject::mismatchedRange);
    check(admit(206, 100, 300, "bytes 100-199/300", "", "", "").accepted());
    check(admit(206, 100, 300, "bytes 100-199/300", "100", "", "").accepted());
    check(admit(206, -1, 300, "bytes 100-299/300", "200", "", "").rejection == Reject::invalidRange);
    check(admit(206, 100, -1, "bytes 100-299/300", "200", "", "").rejection == Reject::invalidRange);
    check(admit(206, 100, 0, "bytes 100-299/300", "200", "", "").accepted());
    // Larger objects may not be fragmented into hundreds of thousands of
    // HTTP requests. A genuinely short final segment is explicitly allowed.
    check(admit(206, 0, 2097152, "bytes 0-0/2097152", "1", "", "").rejection == Reject::fragmentTooSmall);
    check(admit(206, 65536, 2097152, "bytes 65536-66535/2097152", "1000", "", "").rejection == Reject::fragmentTooSmall);
    check(admit(206, 0, 2097152, "bytes 0-65535/2097152", "65536", "", "").accepted());
    check(admit(206, 2097149, 2097152, "bytes 2097149-2097151/2097152", "3", "", "").accepted());
    check(admit(206, 0, 800, "bytes 0-0/800", "1", "", "").accepted());
    std::cout << "PASS " << passed << " native range-policy assertions\n";
}
