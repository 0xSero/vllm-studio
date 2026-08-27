const std = @import("std");

const Scheme = std.crypto.sign.ecdsa.EcdsaP256Sha256;
const pkcs8_header = "-----BEGIN PRIVATE KEY-----";
const pkcs8_footer = "-----END PRIVATE KEY-----";
const ec_public_key_oid = [_]u8{ 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01 };
const p256_oid = [_]u8{ 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07 };

const Tlv = struct {
    tag: u8,
    value: []const u8,
    rest: []const u8,
};

pub fn validateOrganization(value: []const u8) !void {
    if (value.len == 0 or value.len > 63 or value[0] == '-' or value[value.len - 1] == '-') return error.InvalidCodeStorageOrganization;
    for (value) |byte| if (!std.ascii.isLower(byte) and !std.ascii.isDigit(byte) and byte != '-') return error.InvalidCodeStorageOrganization;
}

pub fn validateRepository(value: []const u8) !void {
    if (value.len == 0 or value.len > 512 or value[0] == '/' or value[value.len - 1] == '/') return error.InvalidCodeStorageRepository;
    var segments = std.mem.splitScalar(u8, value, '/');
    while (segments.next()) |segment| {
        if (segment.len == 0 or std.mem.eql(u8, segment, ".") or std.mem.eql(u8, segment, "..")) return error.InvalidCodeStorageRepository;
        for (segment) |byte| if (!std.ascii.isAlphanumeric(byte) and byte != '-' and byte != '_' and byte != '.') return error.InvalidCodeStorageRepository;
    }
}

pub fn validatePrivateKey(allocator: std.mem.Allocator, pem: []const u8) !void {
    _ = try keyPair(allocator, pem);
}

pub fn mint(allocator: std.mem.Allocator, io: std.Io, organization: []const u8, account_id: []const u8, pem: []const u8, repository: ?[]const u8, scopes: []const []const u8) ![]u8 {
    _ = account_id;
    try validateOrganization(organization);
    if (repository) |value| try validateRepository(value);
    const pair = try keyPair(allocator, pem);
    const now = @max(std.Io.Clock.real.now(io).toSeconds(), 0);
    var payload: std.Io.Writer.Allocating = .init(allocator);
    defer payload.deinit();
    try payload.writer.writeAll("{\"iss\":");
    try std.json.Stringify.value(organization, .{}, &payload.writer);
    try payload.writer.writeAll(",\"sub\":");
    try std.json.Stringify.value("@pierre/storage", .{}, &payload.writer);
    if (repository) |value| {
        try payload.writer.writeAll(",\"repo\":");
        try std.json.Stringify.value(value, .{}, &payload.writer);
    }
    try payload.writer.writeAll(",\"scopes\":[");
    for (scopes, 0..) |scope, index| {
        if (index > 0) try payload.writer.writeByte(',');
        try std.json.Stringify.value(scope, .{}, &payload.writer);
    }
    try payload.writer.print("],\"iat\":{d},\"exp\":{d}}}", .{ now, now + 600 });
    const header = "{\"alg\":\"ES256\",\"typ\":\"JWT\"}";
    const header_size = std.base64.url_safe_no_pad.Encoder.calcSize(header.len);
    const payload_size = std.base64.url_safe_no_pad.Encoder.calcSize(payload.writer.buffered().len);
    var signing_input = try allocator.alloc(u8, header_size + 1 + payload_size);
    defer allocator.free(signing_input);
    _ = std.base64.url_safe_no_pad.Encoder.encode(signing_input[0..header_size], header);
    signing_input[header_size] = '.';
    _ = std.base64.url_safe_no_pad.Encoder.encode(signing_input[header_size + 1 ..], payload.writer.buffered());
    var noise: [Scheme.noise_length]u8 = undefined;
    io.random(&noise);
    const signature = try pair.sign(signing_input, noise);
    const signature_bytes = signature.toBytes();
    const signature_size = std.base64.url_safe_no_pad.Encoder.calcSize(signature_bytes.len);
    const token = try allocator.alloc(u8, signing_input.len + 1 + signature_size);
    @memcpy(token[0..signing_input.len], signing_input);
    token[signing_input.len] = '.';
    _ = std.base64.url_safe_no_pad.Encoder.encode(token[signing_input.len + 1 ..], &signature_bytes);
    return token;
}

fn keyPair(allocator: std.mem.Allocator, pem: []const u8) !Scheme.KeyPair {
    const trimmed = std.mem.trim(u8, pem, " \t\r\n");
    if (!std.mem.startsWith(u8, trimmed, pkcs8_header) or !std.mem.endsWith(u8, trimmed, pkcs8_footer)) return error.InvalidCodeStoragePrivateKey;
    const encoded_value = trimmed[pkcs8_header.len .. trimmed.len - pkcs8_footer.len];
    var encoded = std.ArrayList(u8).empty;
    defer encoded.deinit(allocator);
    for (encoded_value) |byte| if (!std.ascii.isWhitespace(byte)) try encoded.append(allocator, byte);
    const decoded_size = std.base64.standard.Decoder.calcSizeForSlice(encoded.items) catch return error.InvalidCodeStoragePrivateKey;
    const decoded = try allocator.alloc(u8, decoded_size);
    defer allocator.free(decoded);
    std.base64.standard.Decoder.decode(decoded, encoded.items) catch return error.InvalidCodeStoragePrivateKey;
    const outer = try readTlv(decoded);
    if (outer.tag != 0x30 or outer.rest.len != 0) return error.InvalidCodeStoragePrivateKey;
    const version = try readTlv(outer.value);
    if (version.tag != 0x02 or version.value.len != 1 or version.value[0] != 0) return error.InvalidCodeStoragePrivateKey;
    const algorithm = try readTlv(version.rest);
    if (algorithm.tag != 0x30 or !std.mem.containsAtLeast(u8, algorithm.value, 1, &ec_public_key_oid) or !std.mem.containsAtLeast(u8, algorithm.value, 1, &p256_oid)) return error.InvalidCodeStoragePrivateKey;
    const private_wrapper = try readTlv(algorithm.rest);
    if (private_wrapper.tag != 0x04 or private_wrapper.rest.len != 0) return error.InvalidCodeStoragePrivateKey;
    const ec_sequence = try readTlv(private_wrapper.value);
    if (ec_sequence.tag != 0x30 or ec_sequence.rest.len != 0) return error.InvalidCodeStoragePrivateKey;
    const ec_version = try readTlv(ec_sequence.value);
    if (ec_version.tag != 0x02 or ec_version.value.len != 1 or ec_version.value[0] != 1) return error.InvalidCodeStoragePrivateKey;
    const scalar = try readTlv(ec_version.rest);
    if (scalar.tag != 0x04 or scalar.value.len != Scheme.SecretKey.encoded_length) return error.InvalidCodeStoragePrivateKey;
    const secret = try Scheme.SecretKey.fromBytes(scalar.value[0..Scheme.SecretKey.encoded_length].*);
    return Scheme.KeyPair.fromSecretKey(secret) catch return error.InvalidCodeStoragePrivateKey;
}

fn readTlv(input: []const u8) !Tlv {
    if (input.len < 2) return error.InvalidCodeStoragePrivateKey;
    var offset: usize = 2;
    var length: usize = input[1];
    if (length & 0x80 != 0) {
        const count = length & 0x7f;
        if (count == 0 or count > @sizeOf(usize) or input.len < 2 + count) return error.InvalidCodeStoragePrivateKey;
        length = 0;
        for (input[2 .. 2 + count]) |byte| {
            length = std.math.mul(usize, length, 256) catch return error.InvalidCodeStoragePrivateKey;
            length = std.math.add(usize, length, byte) catch return error.InvalidCodeStoragePrivateKey;
        }
        offset += count;
    }
    const end = std.math.add(usize, offset, length) catch return error.InvalidCodeStoragePrivateKey;
    if (end > input.len) return error.InvalidCodeStoragePrivateKey;
    return .{ .tag = input[0], .value = input[offset..end], .rest = input[end..] };
}
