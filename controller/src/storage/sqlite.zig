const std = @import("std");
const builtin = @import("builtin");

const sqlite3 = opaque {};
const sqlite3_stmt = opaque {};
const SQLITE_OK = 0;
const SQLITE_ROW = 100;
const SQLITE_DONE = 101;
const SQLITE_INTEGER = 1;
const SQLITE_FLOAT = 2;
const SQLITE_TEXT = 3;
const SQLITE_BLOB = 4;
const SQLITE_NULL = 5;
const SQLITE_OPEN_READWRITE = 0x00000002;
const SQLITE_OPEN_CREATE = 0x00000004;
const SQLITE_OPEN_FULLMUTEX = 0x00010000;

const Destructor = ?*const anyopaque;
const SQLITE_TRANSIENT: Destructor = @ptrFromInt(std.math.maxInt(usize));
const Open = *const fn ([*:0]const u8, *?*sqlite3, c_int, ?[*:0]const u8) callconv(.c) c_int;
const Close = *const fn (*sqlite3) callconv(.c) c_int;
const BusyTimeout = *const fn (*sqlite3, c_int) callconv(.c) c_int;
const Prepare = *const fn (*sqlite3, [*]const u8, c_int, *?*sqlite3_stmt, ?*?[*]const u8) callconv(.c) c_int;
const StepFn = *const fn (*sqlite3_stmt) callconv(.c) c_int;
const Reset = *const fn (*sqlite3_stmt) callconv(.c) c_int;
const ClearBindings = *const fn (*sqlite3_stmt) callconv(.c) c_int;
const BindNull = *const fn (*sqlite3_stmt, c_int) callconv(.c) c_int;
const BindInt64 = *const fn (*sqlite3_stmt, c_int, i64) callconv(.c) c_int;
const BindDouble = *const fn (*sqlite3_stmt, c_int, f64) callconv(.c) c_int;
const BindText = *const fn (*sqlite3_stmt, c_int, [*]const u8, c_int, Destructor) callconv(.c) c_int;
const BindBlob = *const fn (*sqlite3_stmt, c_int, *const anyopaque, c_int, Destructor) callconv(.c) c_int;
const ColumnType = *const fn (*sqlite3_stmt, c_int) callconv(.c) c_int;
const ColumnInt64 = *const fn (*sqlite3_stmt, c_int) callconv(.c) i64;
const ColumnDouble = *const fn (*sqlite3_stmt, c_int) callconv(.c) f64;
const ColumnText = *const fn (*sqlite3_stmt, c_int) callconv(.c) ?[*]const u8;
const ColumnBlob = *const fn (*sqlite3_stmt, c_int) callconv(.c) ?*const anyopaque;
const ColumnBytes = *const fn (*sqlite3_stmt, c_int) callconv(.c) c_int;
const Finalize = *const fn (*sqlite3_stmt) callconv(.c) c_int;
const ExecCallback = *const fn (?*anyopaque, c_int, [*]?[*:0]u8, [*]?[*:0]u8) callconv(.c) c_int;
const Exec = *const fn (*sqlite3, [*:0]const u8, ?ExecCallback, ?*anyopaque, *?[*:0]u8) callconv(.c) c_int;
const Free = *const fn (?*anyopaque) callconv(.c) void;
const ErrorCode = *const fn (*sqlite3) callconv(.c) c_int;
const ErrorMessage = *const fn (*sqlite3) callconv(.c) [*:0]const u8;
const Changes64 = *const fn (*sqlite3) callconv(.c) i64;
const LibraryVersion = *const fn () callconv(.c) [*:0]const u8;

const Api = struct {
    open_v2: Open,
    close_v2: Close,
    busy_timeout: BusyTimeout,
    prepare_v2: Prepare,
    step: StepFn,
    reset: Reset,
    clear_bindings: ClearBindings,
    bind_null: BindNull,
    bind_int64: BindInt64,
    bind_double: BindDouble,
    bind_text: BindText,
    bind_blob: BindBlob,
    column_type: ColumnType,
    column_int64: ColumnInt64,
    column_double: ColumnDouble,
    column_text: ColumnText,
    column_blob: ColumnBlob,
    column_bytes: ColumnBytes,
    finalize: Finalize,
    exec: Exec,
    free: Free,
    errcode: ErrorCode,
    extended_errcode: ErrorCode,
    errmsg: ErrorMessage,
    changes64: Changes64,
    libversion: LibraryVersion,

    fn load(library: *std.DynLib) !Api {
        return .{
            .open_v2 = try loadSymbol(library, Open, "sqlite3_open_v2"),
            .close_v2 = try loadSymbol(library, Close, "sqlite3_close_v2"),
            .busy_timeout = try loadSymbol(library, BusyTimeout, "sqlite3_busy_timeout"),
            .prepare_v2 = try loadSymbol(library, Prepare, "sqlite3_prepare_v2"),
            .step = try loadSymbol(library, StepFn, "sqlite3_step"),
            .reset = try loadSymbol(library, Reset, "sqlite3_reset"),
            .clear_bindings = try loadSymbol(library, ClearBindings, "sqlite3_clear_bindings"),
            .bind_null = try loadSymbol(library, BindNull, "sqlite3_bind_null"),
            .bind_int64 = try loadSymbol(library, BindInt64, "sqlite3_bind_int64"),
            .bind_double = try loadSymbol(library, BindDouble, "sqlite3_bind_double"),
            .bind_text = try loadSymbol(library, BindText, "sqlite3_bind_text"),
            .bind_blob = try loadSymbol(library, BindBlob, "sqlite3_bind_blob"),
            .column_type = try loadSymbol(library, ColumnType, "sqlite3_column_type"),
            .column_int64 = try loadSymbol(library, ColumnInt64, "sqlite3_column_int64"),
            .column_double = try loadSymbol(library, ColumnDouble, "sqlite3_column_double"),
            .column_text = try loadSymbol(library, ColumnText, "sqlite3_column_text"),
            .column_blob = try loadSymbol(library, ColumnBlob, "sqlite3_column_blob"),
            .column_bytes = try loadSymbol(library, ColumnBytes, "sqlite3_column_bytes"),
            .finalize = try loadSymbol(library, Finalize, "sqlite3_finalize"),
            .exec = try loadSymbol(library, Exec, "sqlite3_exec"),
            .free = try loadSymbol(library, Free, "sqlite3_free"),
            .errcode = try loadSymbol(library, ErrorCode, "sqlite3_errcode"),
            .extended_errcode = try loadSymbol(library, ErrorCode, "sqlite3_extended_errcode"),
            .errmsg = try loadSymbol(library, ErrorMessage, "sqlite3_errmsg"),
            .changes64 = try loadSymbol(library, Changes64, "sqlite3_changes64"),
            .libversion = try loadSymbol(library, LibraryVersion, "sqlite3_libversion"),
        };
    }
};

pub const Step = enum {
    row,
    done,
};

pub const ValueType = enum {
    integer,
    float,
    text,
    blob,
    null,
};

pub const ErrorInfo = struct {
    code: c_int,
    extended_code: c_int,
    message: []const u8,
};

pub const Database = struct {
    allocator: std.mem.Allocator,
    library: std.DynLib,
    api: Api,
    handle: *sqlite3,
    mutex: std.Io.Mutex = .init,
    active_statements: std.atomic.Value(usize) = .init(0),
    active_transactions: std.atomic.Value(usize) = .init(0),

    pub fn open(allocator: std.mem.Allocator, path: []const u8) !Database {
        var library = try openLibrary();
        errdefer library.close();
        const api = try Api.load(&library);
        const path_z = try allocator.dupeZ(u8, path);
        defer allocator.free(path_z);

        var handle: ?*sqlite3 = null;
        const flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX;
        if (api.open_v2(path_z.ptr, &handle, flags, null) != SQLITE_OK) {
            if (handle) |opened| _ = api.close_v2(opened);
            return error.DatabaseOpenFailed;
        }
        const opened = handle orelse return error.DatabaseOpenFailed;
        errdefer _ = api.close_v2(opened);
        if (api.busy_timeout(opened, 5_000) != SQLITE_OK) return error.DatabaseConfigureFailed;
        if (!std.mem.eql(u8, path, ":memory:")) _ = std.c.chmod(path_z.ptr, 0o600);
        return .{ .allocator = allocator, .library = library, .api = api, .handle = opened };
    }

    pub fn deinit(database: *Database) void {
        std.debug.assert(database.active_statements.load(.acquire) == 0);
        std.debug.assert(database.active_transactions.load(.acquire) == 0);
        if (database.api.close_v2(database.handle) != SQLITE_OK) {
            std.log.err("SQLite close failed: {s}", .{database.api.errmsg(database.handle)});
        }
        database.library.close();
        database.* = undefined;
    }

    pub fn prepare(database: *Database, sql: []const u8) !Statement {
        const sql_length = std.math.cast(c_int, sql.len) orelse return error.SqliteValueTooLarge;
        var handle: ?*sqlite3_stmt = null;
        if (database.api.prepare_v2(database.handle, sql.ptr, sql_length, &handle, null) != SQLITE_OK) {
            return error.DatabasePrepareFailed;
        }
        const prepared = handle orelse return error.DatabasePrepareFailed;
        _ = database.active_statements.fetchAdd(1, .acq_rel);
        return .{ .database = database, .handle = prepared };
    }

    pub fn execute(database: *Database, sql: []const u8) !void {
        var statement = try database.prepare(sql);
        defer statement.deinit();
        if (try statement.step() != .done) return error.DatabaseUnexpectedRow;
    }

    pub fn executeScript(database: *Database, sql: []const u8) !void {
        const sql_z = try database.allocator.dupeZ(u8, sql);
        defer database.allocator.free(sql_z);
        var message: ?[*:0]u8 = null;
        defer if (message) |allocated| database.api.free(allocated);
        if (database.api.exec(database.handle, sql_z.ptr, null, null, &message) != SQLITE_OK) {
            return error.DatabaseExecuteFailed;
        }
    }

    pub fn begin(database: *Database) !Transaction {
        try database.execute("BEGIN");
        _ = database.active_transactions.fetchAdd(1, .acq_rel);
        return .{ .database = database };
    }

    pub fn migrate(database: *Database, scripts: []const []const u8) !void {
        var transaction = try database.begin();
        defer transaction.deinit();
        for (scripts) |script| try database.executeScript(script);
        try transaction.commit();
    }

    pub fn quickCheck(database: *Database) !bool {
        var statement = try database.prepare("PRAGMA quick_check");
        defer statement.deinit();
        if (try statement.step() != .row) return error.DatabaseQueryFailed;
        const text = statement.columnText(0) orelse return false;
        return std.mem.eql(u8, text, "ok");
    }

    pub fn changes(database: *const Database) i64 {
        return database.api.changes64(database.handle);
    }

    pub fn errorInfo(database: *const Database) ErrorInfo {
        return .{
            .code = database.api.errcode(database.handle),
            .extended_code = database.api.extended_errcode(database.handle),
            .message = std.mem.span(database.api.errmsg(database.handle)),
        };
    }

    pub fn version(database: *const Database) []const u8 {
        return std.mem.span(database.api.libversion());
    }

    pub fn lock(database: *Database, io: std.Io) std.Io.Cancelable!void {
        try database.mutex.lock(io);
    }

    pub fn unlock(database: *Database, io: std.Io) void {
        database.mutex.unlock(io);
    }
};

pub const Statement = struct {
    database: *Database,
    handle: ?*sqlite3_stmt,

    pub fn deinit(statement: *Statement) void {
        const handle = statement.handle orelse return;
        statement.handle = null;
        _ = statement.database.active_statements.fetchSub(1, .acq_rel);
        _ = statement.database.api.finalize(handle);
    }

    pub fn finalize(statement: *Statement) !void {
        const handle = statement.handle orelse return;
        statement.handle = null;
        _ = statement.database.active_statements.fetchSub(1, .acq_rel);
        if (statement.database.api.finalize(handle) != SQLITE_OK) return error.DatabaseFinalizeFailed;
    }

    pub fn bindNull(statement: *Statement, index: u31) !void {
        if (statement.database.api.bind_null(statement.requiredHandle(), @intCast(index)) != SQLITE_OK) return error.DatabaseBindFailed;
    }

    pub fn bindInt(statement: *Statement, index: u31, value: i64) !void {
        if (statement.database.api.bind_int64(statement.requiredHandle(), @intCast(index), value) != SQLITE_OK) return error.DatabaseBindFailed;
    }

    pub fn bindFloat(statement: *Statement, index: u31, value: f64) !void {
        if (statement.database.api.bind_double(statement.requiredHandle(), @intCast(index), value) != SQLITE_OK) return error.DatabaseBindFailed;
    }

    pub fn bindText(statement: *Statement, index: u31, value: []const u8) !void {
        const value_length = std.math.cast(c_int, value.len) orelse return error.SqliteValueTooLarge;
        if (statement.database.api.bind_text(statement.requiredHandle(), @intCast(index), value.ptr, value_length, SQLITE_TRANSIENT) != SQLITE_OK) return error.DatabaseBindFailed;
    }

    pub fn bindBlob(statement: *Statement, index: u31, value: []const u8) !void {
        const value_length = std.math.cast(c_int, value.len) orelse return error.SqliteValueTooLarge;
        if (statement.database.api.bind_blob(statement.requiredHandle(), @intCast(index), value.ptr, value_length, SQLITE_TRANSIENT) != SQLITE_OK) return error.DatabaseBindFailed;
    }

    pub fn step(statement: *Statement) !Step {
        return switch (statement.database.api.step(statement.requiredHandle())) {
            SQLITE_ROW => .row,
            SQLITE_DONE => .done,
            else => error.DatabaseStepFailed,
        };
    }

    pub fn reset(statement: *Statement) !void {
        if (statement.database.api.reset(statement.requiredHandle()) != SQLITE_OK) return error.DatabaseResetFailed;
    }

    pub fn clearBindings(statement: *Statement) !void {
        if (statement.database.api.clear_bindings(statement.requiredHandle()) != SQLITE_OK) return error.DatabaseClearBindingsFailed;
    }

    pub fn columnType(statement: *const Statement, index: u31) ValueType {
        return switch (statement.database.api.column_type(statement.requiredHandle(), @intCast(index))) {
            SQLITE_INTEGER => .integer,
            SQLITE_FLOAT => .float,
            SQLITE_TEXT => .text,
            SQLITE_BLOB => .blob,
            SQLITE_NULL => .null,
            else => unreachable,
        };
    }

    pub fn columnInt(statement: *const Statement, index: u31) i64 {
        return statement.database.api.column_int64(statement.requiredHandle(), @intCast(index));
    }

    pub fn columnFloat(statement: *const Statement, index: u31) f64 {
        return statement.database.api.column_double(statement.requiredHandle(), @intCast(index));
    }

    pub fn columnText(statement: *const Statement, index: u31) ?[]const u8 {
        const handle = statement.requiredHandle();
        const pointer = statement.database.api.column_text(handle, @intCast(index)) orelse return null;
        const length: usize = @intCast(statement.database.api.column_bytes(handle, @intCast(index)));
        return pointer[0..length];
    }

    pub fn columnBlob(statement: *const Statement, index: u31) ?[]const u8 {
        const handle = statement.requiredHandle();
        const pointer = statement.database.api.column_blob(handle, @intCast(index)) orelse return null;
        const length: usize = @intCast(statement.database.api.column_bytes(handle, @intCast(index)));
        const bytes: [*]const u8 = @ptrCast(pointer);
        return bytes[0..length];
    }

    fn requiredHandle(statement: *const Statement) *sqlite3_stmt {
        return statement.handle orelse @panic("SQLite statement already finalized");
    }
};

pub const Transaction = struct {
    database: *Database,
    active: bool = true,

    pub fn deinit(transaction: *Transaction) void {
        if (!transaction.active) return;
        transaction.database.execute("ROLLBACK") catch {
            std.log.err("SQLite transaction rollback failed: {s}", .{transaction.database.errorInfo().message});
        };
        transaction.active = false;
        _ = transaction.database.active_transactions.fetchSub(1, .acq_rel);
    }

    pub fn commit(transaction: *Transaction) !void {
        if (!transaction.active) return error.TransactionClosed;
        try transaction.database.execute("COMMIT");
        transaction.active = false;
        _ = transaction.database.active_transactions.fetchSub(1, .acq_rel);
    }

    pub fn rollback(transaction: *Transaction) !void {
        if (!transaction.active) return error.TransactionClosed;
        try transaction.database.execute("ROLLBACK");
        transaction.active = false;
        _ = transaction.database.active_transactions.fetchSub(1, .acq_rel);
    }
};

fn loadSymbol(library: *std.DynLib, comptime T: type, name: [:0]const u8) !T {
    return library.lookup(T, name) orelse error.SqliteSymbolMissing;
}

fn openLibrary() !std.DynLib {
    const candidates: []const []const u8 = switch (builtin.os.tag) {
        .macos => &.{ "/usr/lib/libsqlite3.dylib", "libsqlite3.dylib" },
        .linux => &.{ "libsqlite3.so.0", "libsqlite3.so" },
        else => return error.SqlitePlatformUnsupported,
    };
    for (candidates) |candidate| {
        return std.DynLib.open(candidate) catch continue;
    }
    return error.SqliteLibraryUnavailable;
}
