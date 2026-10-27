// SPDX-License-Identifier: Apache-2.0
//
// A strict protobuf reader, enough to decode transactions. It refuses
// truncated input, overlong varints and the deprecated group wire types.

use crate::errors::{Error, Result};

pub const WIRE_VARINT: u8 = 0;
pub const WIRE_FIXED64: u8 = 1;
pub const WIRE_LEN: u8 = 2;
pub const WIRE_FIXED32: u8 = 5;

/// One field as read from the wire.
#[derive(Clone, Copy, Debug)]
pub struct Field<'a> {
    pub num: u64,
    pub wire: u8,
    /// Set for varint fields.
    pub int: u64,
    /// Set for length-delimited and fixed fields.
    pub bytes: &'a [u8],
}

fn malformed<T>(message: impl Into<String>) -> Result<T> {
    Err(Error::MalformedTx(message.into()))
}

fn read_varint(buf: &[u8], mut pos: usize) -> Result<(u64, usize)> {
    let mut result: u64 = 0;
    for i in 0..10 {
        let Some(&b) = buf.get(pos) else {
            return malformed("truncated varint");
        };
        pos += 1;
        let low = u64::from(b & 0x7f);
        if i == 9 && low > 1 {
            return malformed("varint overflows 64 bits");
        }
        result |= low << (7 * i);
        if b & 0x80 == 0 {
            return Ok((result, pos));
        }
    }
    malformed("varint longer than 10 bytes")
}

/// Read every field of a message, in order.
pub fn read_fields(buf: &[u8]) -> Result<Vec<Field<'_>>> {
    let mut out = Vec::new();
    let mut pos = 0;
    while pos < buf.len() {
        let (key, next) = read_varint(buf, pos)?;
        pos = next;
        let num = key >> 3;
        let wire = (key & 7) as u8;
        if num == 0 {
            return malformed("field number 0");
        }
        match wire {
            WIRE_VARINT => {
                let (v, p) = read_varint(buf, pos)?;
                pos = p;
                out.push(Field {
                    num,
                    wire,
                    int: v,
                    bytes: &[],
                });
            }
            WIRE_FIXED64 | WIRE_FIXED32 => {
                let n = if wire == WIRE_FIXED64 { 8 } else { 4 };
                if pos + n > buf.len() {
                    return malformed("truncated fixed field");
                }
                out.push(Field {
                    num,
                    wire,
                    int: 0,
                    bytes: &buf[pos..pos + n],
                });
                pos += n;
            }
            WIRE_LEN => {
                let (len, p) = read_varint(buf, pos)?;
                pos = p;
                if len > (buf.len() - pos) as u64 {
                    return malformed("length-delimited field runs past the end");
                }
                let n = len as usize;
                out.push(Field {
                    num,
                    wire,
                    int: 0,
                    bytes: &buf[pos..pos + n],
                });
                pos += n;
            }
            other => return malformed(format!("unsupported wire type {other}")),
        }
    }
    Ok(out)
}

pub fn expect_wire(f: &Field<'_>, wire: u8, what: &str) -> Result<()> {
    if f.wire != wire {
        return malformed(format!(
            "{what}: field {} has wire type {}, expected {wire}",
            f.num, f.wire
        ));
    }
    Ok(())
}

pub fn as_string(f: &Field<'_>, what: &str) -> Result<String> {
    expect_wire(f, WIRE_LEN, what)?;
    match std::str::from_utf8(f.bytes) {
        Ok(s) => Ok(s.to_string()),
        Err(_) => malformed(format!("{what}: field {} is not valid UTF-8", f.num)),
    }
}

pub fn as_bytes<'a>(f: &Field<'a>, what: &str) -> Result<&'a [u8]> {
    expect_wire(f, WIRE_LEN, what)?;
    Ok(f.bytes)
}

pub fn as_uint(f: &Field<'_>, what: &str) -> Result<u64> {
    expect_wire(f, WIRE_VARINT, what)?;
    Ok(f.int)
}
