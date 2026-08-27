const std = @import("std");

const c = std.c;
const posix = std.posix;
const invalid_handle: c.fd_t = -1;

var requested = std.atomic.Value(bool).init(false);
var signal_write_handle = std.atomic.Value(c.fd_t).init(invalid_handle);
var previous_interrupt: posix.Sigaction = undefined;
var previous_terminate: posix.Sigaction = undefined;

pub const Shutdown = struct {
    read_handle: c.fd_t,
    write_handle: c.fd_t,

    pub fn init() !Shutdown {
        var handles: [2]c.fd_t = undefined;
        if (c.pipe(&handles) != 0) return error.ShutdownPipeFailed;
        requested.store(false, .release);
        signal_write_handle.store(handles[1], .release);
        const action: posix.Sigaction = .{
            .handler = .{ .handler = handleSignal },
            .mask = posix.sigemptyset(),
            .flags = 0,
        };
        posix.sigaction(.INT, &action, &previous_interrupt);
        posix.sigaction(.TERM, &action, &previous_terminate);
        return .{ .read_handle = handles[0], .write_handle = handles[1] };
    }

    pub fn deinit(controller: *Shutdown) void {
        signal_write_handle.store(invalid_handle, .release);
        posix.sigaction(.INT, &previous_interrupt, null);
        posix.sigaction(.TERM, &previous_terminate, null);
        _ = c.close(controller.read_handle);
        _ = c.close(controller.write_handle);
        controller.* = undefined;
    }

    pub fn wait(controller: *Shutdown) !void {
        var byte: [1]u8 = undefined;
        while (true) {
            const count = c.read(controller.read_handle, &byte, byte.len);
            if (count == 1) return;
            if (count == 0) return error.ShutdownPipeClosed;
            if (posix.errno(count) != .INTR) return error.ShutdownPipeReadFailed;
        }
    }

    pub fn request(controller: *Shutdown) void {
        notify(controller.write_handle);
    }
};

pub fn isRequested() bool {
    return requested.load(.acquire);
}

fn handleSignal(_: posix.SIG) callconv(.c) void {
    notify(signal_write_handle.load(.acquire));
}

fn notify(handle: c.fd_t) void {
    if (requested.swap(true, .acq_rel) or handle == invalid_handle) return;
    const byte = [_]u8{1};
    _ = c.write(handle, &byte, byte.len);
}
