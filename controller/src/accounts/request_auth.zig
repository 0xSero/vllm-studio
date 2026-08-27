const std = @import("std");

pub fn authorized(request: *const std.http.Server.Request, expected: ?[]const u8) bool {
    const secret = expected orelse return true;
    if (secret.len == 0) return true;
    var iterator = request.iterateHeaders();
    while (iterator.next()) |header| {
        if (std.ascii.eqlIgnoreCase(header.name, "authorization")) {
            const value = std.mem.trim(u8, header.value, " \t\r\n");
            if (value.len > "Bearer ".len and std.ascii.startsWithIgnoreCase(value, "Bearer ")) {
                if (safeEqual(secret, std.mem.trim(u8, value["Bearer ".len..], " \t\r\n"))) return true;
            }
        }
        if (std.ascii.eqlIgnoreCase(header.name, "x-api-key") and safeEqual(secret, std.mem.trim(u8, header.value, " \t\r\n"))) return true;
    }
    return false;
}

fn safeEqual(expected: []const u8, provided: []const u8) bool {
    if (expected.len != provided.len) return false;
    var difference: u8 = 0;
    for (expected, provided) |left, right| difference |= left ^ right;
    return difference == 0;
}
