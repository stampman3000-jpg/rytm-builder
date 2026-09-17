//! Split / concatenate Elektron sysex and decode via libanalogrytm (rytm-sys).

use crate::layout::*;
use rytm_sys::{
    ar_pattern_track_get_trig_flags, ar_raw_to_sysex, ar_sysex_meta_t, ar_sysex_to_raw,
};
use std::path::Path;

#[derive(Clone, Debug)]
pub struct Object {
    pub sysex: Vec<u8>,
    pub raw: Vec<u8>,
    pub obj_type: u8,
    pub obj_nr: u16,
}

#[derive(Clone, Debug)]
pub struct Project {
    pub path: String,
    pub objects: Vec<Object>,
}

pub fn split_sysex(data: &[u8]) -> Result<Vec<&[u8]>, String> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < data.len() {
        if data[i] != 0xF0 {
            return Err(format!("expected F0 at offset {i}, got {:02X}", data[i]));
        }
        let rel = data[i..]
            .iter()
            .position(|&b| b == 0xF7)
            .ok_or_else(|| format!("unterminated sysex at {i}"))?;
        let end = i + rel + 1;
        out.push(&data[i..end]);
        i = end;
    }
    Ok(out)
}

fn meta_default() -> ar_sysex_meta_t {
    unsafe { std::mem::zeroed() }
}

pub fn decode_message(sysex: &[u8]) -> Result<Object, String> {
    if sysex.len() < 8 || sysex[0] != 0xF0 || sysex[sysex.len() - 1] != 0xF7 {
        return Err("not a sysex message".into());
    }
    let mut meta = meta_default();
    let mut src_ptr = sysex.as_ptr();
    let mut src_sz = sysex.len() as u32;
    let mut dst_sz = 0u32;
    // Query size first with null dest? libanalogrytm ar_sysex_to_raw writes as it goes.
    // Use a generous buffer (max pattern raw ~13k, settings 2k; 64k is plenty).
    let mut dst = vec![0u8; 64 * 1024];
    let rc = unsafe {
        ar_sysex_to_raw(
            dst.as_mut_ptr(),
            &mut src_ptr,
            &mut src_sz,
            &mut dst_sz,
            &mut meta,
        )
    };
    if rc != 0 {
        return Err(format!("ar_sysex_to_raw err={rc} dump_id={:02X}", sysex[6]));
    }
    dst.truncate(dst_sz as usize);
    Ok(Object {
        sysex: sysex.to_vec(),
        raw: dst,
        obj_type: meta.obj_type,
        obj_nr: meta.obj_nr,
    })
}

pub fn encode_object(obj: &mut Object) -> Result<(), String> {
    let mut meta = meta_default();
    meta.obj_type = obj.obj_type;
    meta.obj_nr = obj.obj_nr;
    // Keep container version 0x0101 like dumps.
    meta.container_version.b.hi = 1;
    meta.container_version.b.lo = 1;

    let mut need = 0u32;
    let rc = unsafe {
        ar_raw_to_sysex(
            std::ptr::null_mut(),
            obj.raw.as_ptr(),
            obj.raw.len() as u32,
            &mut need,
            &meta,
        )
    };
    if rc != 0 {
        return Err(format!("ar_raw_to_sysex size query err={rc}"));
    }
    let mut buf = vec![0u8; need as usize];
    let rc = unsafe {
        ar_raw_to_sysex(
            buf.as_mut_ptr(),
            obj.raw.as_ptr(),
            obj.raw.len() as u32,
            std::ptr::null_mut(),
            &meta,
        )
    };
    if rc != 0 {
        return Err(format!("ar_raw_to_sysex encode err={rc}"));
    }
    obj.sysex = buf;
    Ok(())
}

pub fn load_project(path: &Path) -> Result<Project, String> {
    let data = std::fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let msgs = split_sysex(&data)?;
    let mut objects = Vec::with_capacity(msgs.len());
    for (i, m) in msgs.iter().enumerate() {
        objects.push(decode_message(m).map_err(|e| format!("msg {i}: {e}"))?);
    }
    Ok(Project {
        path: path.display().to_string(),
        objects,
    })
}

pub fn md5_hex(data: &[u8]) -> String {
    format!("{:x}", md5::compute(data))
}

pub fn md5_file(path: &Path) -> Result<String, String> {
    let data = std::fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    Ok(md5_hex(&data))
}

#[derive(Clone, Debug)]
pub struct ExportCheck {
    pub bytes: usize,
    pub messages: usize,
    pub md5: String,
    pub prefix: Vec<&'static str>,
    pub settings_first: bool,
}

/// Inspect concatenated sysex: message count, MD5, and that settings come first.
pub fn inspect_export(data: &[u8]) -> Result<ExportCheck, String> {
    let msgs = split_sysex(data)?;
    if msgs.is_empty() {
        return Err("export is empty".into());
    }
    let mut prefix = Vec::new();
    for m in msgs.iter().take(6) {
        if m.len() < 7 {
            return Err("truncated sysex in export".into());
        }
        prefix.push(dump_type_name(m[6]));
    }
    let settings_first = msgs[0].len() >= 7 && msgs[0][6] == DUMP_SETTINGS;
    if !settings_first {
        return Err("export is not settings-first (first message dump_id != 0x56 Settings)".into());
    }
    Ok(ExportCheck {
        bytes: data.len(),
        messages: msgs.len(),
        md5: md5_hex(data),
        prefix,
        settings_first: true,
    })
}

pub fn sample_slots_used(project: &Project) -> usize {
    let Some(set) = find_raw(project, OBJ_SETTINGS, 0) else {
        return 0;
    };
    (0..NUM_SAMPLE_SLOTS)
        .filter(|&i| {
            settings_row(&set.raw, i)
                .map(|r| !slot_unused(r))
                .unwrap_or(false)
        })
        .count()
}

/// Settings, globals, kits, sounds, patterns, songs — Gate C bind order.
pub fn concatenate_settings_first(project: &Project) -> Vec<u8> {
    let order = [
        OBJ_SETTINGS,
        OBJ_GLOBAL,
        OBJ_KIT,
        OBJ_SOUND,
        OBJ_PATTERN,
        OBJ_SONG,
    ];
    let mut out = Vec::new();
    for t in order {
        for o in &project.objects {
            if o.obj_type == t {
                out.extend_from_slice(&o.sysex);
            }
        }
    }
    // Any unexpected types last.
    for o in &project.objects {
        if !order.contains(&o.obj_type) {
            out.extend_from_slice(&o.sysex);
        }
    }
    out
}

pub fn write_settings_first(project: &Project, path: &Path) -> Result<ExportCheck, String> {
    if path.exists() {
        return Err(format!(
            "refusing to overwrite existing {} — pick a new --out path",
            path.display()
        ));
    }
    let bytes = concatenate_settings_first(project);
    let check = inspect_export(&bytes)?;
    if check.messages != project.objects.len() {
        return Err(format!(
            "export message count {} != in-memory {}",
            check.messages,
            project.objects.len()
        ));
    }
    std::fs::write(path, &bytes).map_err(|e| format!("write {}: {e}", path.display()))?;
    Ok(check)
}

pub fn find_raw(project: &Project, obj_type: u8, nr: u8) -> Option<&Object> {
    project
        .objects
        .iter()
        .find(|o| o.obj_type == obj_type && o.obj_nr == u16::from(nr))
}

pub fn find_raw_mut(project: &mut Project, obj_type: u8, nr: u8) -> Option<&mut Object> {
    project
        .objects
        .iter_mut()
        .find(|o| o.obj_type == obj_type && o.obj_nr == u16::from(nr))
}

pub fn count_pattern_trigs(raw: &[u8]) -> u32 {
    if raw.len() < PATTERN_TRACKS + NUM_TRACKS * TRACK_RAW_SZ {
        return 0;
    }
    let mut total = 0u32;
    for t in 0..NUM_TRACKS {
        let off = PATTERN_TRACKS + t * TRACK_RAW_SZ;
        let track = &raw[off..off + TRACK_RAW_SZ];
        for step in 0..64u32 {
            let flags = unsafe { ar_pattern_track_get_trig_flags(track.as_ptr().cast(), step) };
            if flags & 1 != 0 {
                total += 1;
            }
        }
    }
    total
}

pub fn pattern_kit_number(raw: &[u8]) -> u8 {
    raw.get(PATTERN_KIT_NUMBER).copied().unwrap_or(0xFF)
}

pub fn kit_sample_nrs(raw: &[u8]) -> Vec<(usize, u8)> {
    let mut out = Vec::new();
    for t in 0..KIT_TRACK_COUNT {
        let off = KIT_TRACKS + t * SOUND_RAW_SZ + SOUND_SAMPLE_NR;
        if let Some(&nr) = raw.get(off) {
            out.push((t, nr));
        }
    }
    out
}

/// Count SMP_NR plock *values* in 1..=127 (same rewrite sites compose remaps).
pub fn count_smp_nr_plock_values(pattern: &[u8]) -> u32 {
    let mut n = 0u32;
    for i in 0..NUM_PLOCK_SEQS {
        let off = PLOCK_SEQS + i * PLOCK_SEQ_SZ;
        if off + PLOCK_SEQ_SZ > pattern.len() {
            break;
        }
        if pattern[off] != PLOCK_TYPE_SMP_NR {
            continue;
        }
        for b in 0..64 {
            let v = pattern[off + 2 + b];
            if (1..=127).contains(&v) {
                n += 1;
            }
        }
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obj(t: u8, nr: u8, dump: u8) -> Object {
        Object {
            sysex: vec![0xF0, 0x00, 0x20, 0x3C, 0x07, 0x00, dump, 0xF7],
            raw: vec![],
            obj_type: t,
            obj_nr: u16::from(nr),
        }
    }

    #[test]
    fn concatenate_puts_settings_before_kits() {
        let p = Project {
            path: "x".into(),
            objects: vec![
                obj(OBJ_KIT, 0, DUMP_KIT),
                obj(OBJ_PATTERN, 0, DUMP_PATTERN),
                obj(OBJ_SETTINGS, 0, DUMP_SETTINGS),
                obj(OBJ_GLOBAL, 0, DUMP_GLOBAL),
                obj(OBJ_GLOBAL, 1, DUMP_GLOBAL),
            ],
        };
        let bytes = concatenate_settings_first(&p);
        let check = inspect_export(&bytes).unwrap();
        assert!(check.settings_first);
        assert_eq!(
            check.prefix,
            vec!["Settings", "Global", "Global", "Kit", "Pattern"]
        );
        assert_eq!(check.messages, 5);
        assert_eq!(check.bytes, bytes.len());
        assert_eq!(check.md5, md5_hex(&bytes));
    }

    #[test]
    fn kits_first_export_is_rejected() {
        let p = Project {
            path: "x".into(),
            objects: vec![obj(OBJ_KIT, 0, DUMP_KIT)],
        };
        let bytes: Vec<u8> = p.objects.iter().flat_map(|o| o.sysex.clone()).collect();
        let err = inspect_export(&bytes).unwrap_err();
        assert!(err.contains("settings-first"));
    }

    #[test]
    fn refuse_overwrite() {
        let path = std::env::temp_dir().join("rytm_builder_overwrite_test.syx");
        std::fs::write(&path, b"nope").unwrap();
        let p = Project {
            path: "x".into(),
            objects: vec![obj(OBJ_SETTINGS, 0, DUMP_SETTINGS)],
        };
        let err = write_settings_first(&p, &path).unwrap_err();
        assert!(err.contains("overwrite"));
        let _ = std::fs::remove_file(&path);
    }
}
