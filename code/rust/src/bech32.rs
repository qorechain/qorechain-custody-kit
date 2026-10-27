// SPDX-License-Identifier: Apache-2.0
//
// Bech32 (BIP-173) with error classification. QoreChain addresses use the
// original bech32 checksum, not bech32m. Kept separate from QoreSign so that
// every language of the kit reports the same error code for the same input.

const CHARSET: &[u8; 32] = b"qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR: [u32; 5] = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

/// `MIXED_CASE`, `BAD_BECH32` or `BAD_CHECKSUM`, with a message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Bech32Error {
    pub code: &'static str,
    pub message: String,
}

fn err(code: &'static str, message: impl Into<String>) -> Bech32Error {
    Bech32Error {
        code,
        message: message.into(),
    }
}

fn polymod(values: &[u8]) -> u32 {
    let mut chk: u32 = 1;
    for &v in values {
        let top = chk >> 25;
        chk = ((chk & 0x1ffffff) << 5) ^ u32::from(v);
        for (i, g) in GENERATOR.iter().enumerate() {
            if (top >> i) & 1 == 1 {
                chk ^= g;
            }
        }
    }
    chk
}

fn hrp_expand(hrp: &str) -> Vec<u8> {
    let mut out: Vec<u8> = hrp.bytes().map(|c| c >> 5).collect();
    out.push(0);
    out.extend(hrp.bytes().map(|c| c & 31));
    out
}

fn convert_bits(data: &[u8], from: u32, to: u32, pad: bool) -> Result<Vec<u8>, Bech32Error> {
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    let maxv: u32 = (1 << to) - 1;
    let mut out = Vec::new();
    for &value in data {
        acc = (acc << from) | u32::from(value);
        bits += from;
        while bits >= to {
            bits -= to;
            out.push(((acc >> bits) & maxv) as u8);
        }
        acc &= (1 << bits) - 1;
    }
    if pad {
        if bits > 0 {
            out.push(((acc << (to - bits)) & maxv) as u8);
        }
    } else if bits >= from || ((acc << (to - bits)) & maxv) != 0 {
        return Err(err("BAD_BECH32", "invalid padding in the data part"));
    }
    Ok(out)
}

/// Decode a bech32 string into its human-readable part and data bytes.
pub fn bech32_decode(input: &str) -> Result<(String, Vec<u8>), Bech32Error> {
    let lower = input.to_lowercase();
    let upper = input.to_uppercase();
    if input != lower && input != upper {
        return Err(err(
            "MIXED_CASE",
            "bech32 strings must be all lowercase or all uppercase",
        ));
    }
    let pos = match lower.rfind('1') {
        Some(p) if p >= 1 && p + 7 <= lower.len() => p,
        _ => return Err(err("BAD_BECH32", "missing separator, prefix or checksum")),
    };
    let hrp = &lower[..pos];
    if hrp.bytes().any(|c| !(33..=126).contains(&c)) {
        return Err(err("BAD_BECH32", "invalid character in the prefix"));
    }
    let mut data = Vec::new();
    for ch in lower[pos + 1..].chars() {
        match CHARSET.iter().position(|&c| char::from(c) == ch) {
            Some(v) => data.push(v as u8),
            None => return Err(err("BAD_BECH32", format!("invalid character {ch:?}"))),
        }
    }
    let mut values = hrp_expand(hrp);
    values.extend_from_slice(&data);
    if polymod(&values) != 1 {
        return Err(err("BAD_CHECKSUM", "bech32 checksum does not match"));
    }
    let bytes = convert_bits(&data[..data.len() - 6], 5, 8, false)?;
    Ok((hrp.to_string(), bytes))
}

/// Encode bytes as bech32 (lowercase).
pub fn bech32_encode(hrp: &str, bytes: &[u8]) -> String {
    let words = convert_bits(bytes, 8, 5, true).expect("padding never fails");
    let mut values = hrp_expand(hrp);
    values.extend_from_slice(&words);
    values.extend_from_slice(&[0; 6]);
    let m = polymod(&values) ^ 1;
    let mut out = format!("{hrp}1");
    for w in &words {
        out.push(char::from(CHARSET[usize::from(*w)]));
    }
    for i in 0..6 {
        out.push(char::from(CHARSET[((m >> (5 * (5 - i))) & 31) as usize]));
    }
    out
}
