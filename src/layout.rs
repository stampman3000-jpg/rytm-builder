#![allow(dead_code)]
//! Analog Rytm FW 1.70 / v5 object layout (libanalogrytm). Offsets are into decoded raw bytes.

pub const OBJ_KIT: u8 = 0;
pub const OBJ_SOUND: u8 = 1;
pub const OBJ_PATTERN: u8 = 2;
pub const OBJ_SONG: u8 = 3;
pub const OBJ_SETTINGS: u8 = 4;
pub const OBJ_GLOBAL: u8 = 5;

pub const DUMP_KIT: u8 = 0x52;
pub const DUMP_SOUND: u8 = 0x53;
pub const DUMP_PATTERN: u8 = 0x54;
pub const DUMP_SONG: u8 = 0x55;
pub const DUMP_SETTINGS: u8 = 0x56;
pub const DUMP_GLOBAL: u8 = 0x57;

pub const PATTERN_RAW_SZ: usize = 0x332D;
pub const KIT_RAW_SZ: usize = 0x0A32;
pub const SETTINGS_RAW_SZ: usize = 2087;
pub const SOUND_RAW_SZ: usize = 162;

pub const PATTERN_KIT_NUMBER: usize = 0x3325;
pub const PATTERN_TRACKS: usize = 0x0004;
pub const TRACK_RAW_SZ: usize = 0x0281; // 641
pub const NUM_TRACKS: usize = 13;

pub const PLOCK_SEQS: usize = 0x2091;
pub const PLOCK_SEQ_SZ: usize = 0x42;
pub const NUM_PLOCK_SEQS: usize = 72;
pub const PLOCK_TYPE_SMP_NR: u8 = 0x0A;
pub const PLOCK_TYPE_UNUSED: u8 = 0xFF;

pub const KIT_NAME: usize = 0x0004;
pub const KIT_NAME_LEN: usize = 15;
pub const KIT_TRACKS: usize = 0x002E;
pub const KIT_TRACK_COUNT: usize = 12;
pub const SOUND_SAMPLE_NR: usize = 0x0030;

pub const SETTINGS_SLOTS: usize = 0x001F;
pub const SLOT_BYTES: usize = 16;
pub const NUM_SAMPLE_SLOTS: usize = 128;

pub fn dump_type_name(t: u8) -> &'static str {
    match t {
        DUMP_KIT => "Kit",
        DUMP_SOUND => "Sound",
        DUMP_PATTERN => "Pattern",
        DUMP_SONG => "Song",
        DUMP_SETTINGS => "Settings",
        DUMP_GLOBAL => "Global",
        _ => "Unknown",
    }
}

pub fn obj_type_name(t: u8) -> &'static str {
    match t {
        OBJ_KIT => "Kit",
        OBJ_SOUND => "Sound",
        OBJ_PATTERN => "Pattern",
        OBJ_SONG => "Song",
        OBJ_SETTINGS => "Settings",
        OBJ_GLOBAL => "Global",
        _ => "Unknown",
    }
}

/// Parse A01..H16, A1, or 0..127.
pub fn parse_pattern_index(s: &str) -> Result<u8, String> {
    let s = s.trim();
    if let Ok(n) = s.parse::<u8>() {
        if n < 128 {
            return Ok(n);
        }
        return Err(format!("pattern index {n} out of 0..127"));
    }
    let bytes = s.as_bytes();
    if bytes.is_empty() {
        return Err("empty pattern id".into());
    }
    let bank = bytes[0].to_ascii_uppercase();
    if !(b'A'..=b'H').contains(&bank) {
        return Err(format!("bad pattern id {s:?} (want A01..H16)"));
    }
    let slot: u8 = std::str::from_utf8(&bytes[1..])
        .ok()
        .and_then(|t| t.parse().ok())
        .ok_or_else(|| format!("bad pattern id {s:?}"))?;
    if !(1..=16).contains(&slot) {
        return Err(format!("pattern slot {slot} out of 1..16"));
    }
    Ok((bank - b'A') * 16 + (slot - 1))
}

pub fn pattern_label(idx: u8) -> String {
    let bank = idx / 16;
    let slot = (idx % 16) + 1;
    format!("{}{:02}", (b'A' + bank) as char, slot)
}

pub fn kit_name(raw: &[u8]) -> String {
    if raw.len() < KIT_NAME + KIT_NAME_LEN {
        return String::new();
    }
    let slice = &raw[KIT_NAME..KIT_NAME + KIT_NAME_LEN];
    let end = slice.iter().position(|&b| b == 0).unwrap_or(slice.len());
    slice[..end]
        .iter()
        .map(|&b| {
            if (32..127).contains(&b) {
                b as char
            } else {
                '.'
            }
        })
        .collect()
}

pub fn slot_unused(row: &[u8]) -> bool {
    row.len() >= 4 && row[0] == 0xFF && row[1] == 0xFF && row[2] == 0xFF && row[3] == 0xFF
}

pub fn settings_row(settings: &[u8], slot: usize) -> Option<&[u8]> {
    let off = SETTINGS_SLOTS + slot * SLOT_BYTES;
    settings.get(off..off + SLOT_BYTES)
}

pub fn settings_row_mut(settings: &mut [u8], slot: usize) -> Option<&mut [u8]> {
    let off = SETTINGS_SLOTS + slot * SLOT_BYTES;
    settings.get_mut(off..off + SLOT_BYTES)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ids() {
        assert_eq!(parse_pattern_index("A01").unwrap(), 0);
        assert_eq!(parse_pattern_index("A03").unwrap(), 2);
        assert_eq!(parse_pattern_index("a3").unwrap(), 2);
        assert_eq!(parse_pattern_index("H16").unwrap(), 127);
        assert_eq!(parse_pattern_index("14").unwrap(), 14);
        assert_eq!(pattern_label(2), "A03");
        assert_eq!(pattern_label(14), "A15");
    }
}
