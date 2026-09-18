use crate::layout::*;
use crate::project::{
    count_pattern_trigs, encode_object, find_raw, find_raw_mut, kit_sample_nrs, pattern_kit_number,
    Project,
};
use std::collections::BTreeSet;

pub struct CopySpec {
    pub src_path: String,
    pub pattern: u8,
    pub dest: Option<u8>,
}

pub struct RemapLine {
    pub src_slot: u8,
    pub dest_slot: u8,
    pub action: &'static str,
}

pub struct CopyReport {
    pub src_path: String,
    pub src_pattern: u8,
    pub src_kit: u8,
    pub src_kit_name: String,
    pub dest_pattern: u8,
    pub dest_kit: u8,
    pub trigs: u32,
    pub sample_map: Vec<RemapLine>,
    pub plock_rewrites: u32,
}

pub fn parse_copy_spec(s: &str) -> Result<CopySpec, String> {
    let (left, last) = s
        .rsplit_once(':')
        .ok_or_else(|| format!("--copy wants PATH:PATTERN or PATH:PATTERN:DEST (got {s:?})"))?;
    if let Some((path, mid)) = left.rsplit_once(':') {
        if parse_pattern_index(mid).is_ok() && parse_pattern_index(last).is_ok() {
            return Ok(CopySpec {
                src_path: path.to_string(),
                pattern: parse_pattern_index(mid)?,
                dest: Some(parse_pattern_index(last)?),
            });
        }
    }
    Ok(CopySpec {
        src_path: left.to_string(),
        pattern: parse_pattern_index(last)?,
        dest: None,
    })
}

fn needed_sample_slots(kit: &[u8], pattern: &[u8]) -> BTreeSet<u8> {
    let mut set = BTreeSet::new();
    for (_, nr) in kit_sample_nrs(kit) {
        if (1..=127).contains(&nr) {
            set.insert(nr);
        }
    }
    // SMP_NR plocks
    let base = PLOCK_SEQS;
    for i in 0..NUM_PLOCK_SEQS {
        let off = base + i * PLOCK_SEQ_SZ;
        if off + PLOCK_SEQ_SZ > pattern.len() {
            break;
        }
        let ty = pattern[off];
        if ty != PLOCK_TYPE_SMP_NR {
            continue;
        }
        for b in 0..64 {
            let v = pattern[off + 2 + b];
            if (1..=127).contains(&v) {
                set.insert(v);
            }
        }
    }
    set
}

fn find_fingerprint(settings: &[u8], fp: &[u8]) -> Option<u8> {
    for i in 1..NUM_SAMPLE_SLOTS {
        if let Some(row) = settings_row(settings, i) {
            if !slot_unused(row) && row == fp {
                return Some(i as u8);
            }
        }
    }
    None
}

fn next_free_slot(settings: &[u8], start: usize) -> Result<u8, String> {
    for i in start.max(1)..NUM_SAMPLE_SLOTS {
        if let Some(row) = settings_row(settings, i) {
            if slot_unused(row) {
                return Ok(i as u8);
            }
        }
    }
    Err("destination project is out of sample slots (128)".into())
}

fn nonempty_pattern_kits(dest: &Project) -> [bool; 128] {
    let mut used = [false; 128];
    for o in &dest.objects {
        if o.obj_type != OBJ_PATTERN {
            continue;
        }
        if count_pattern_trigs(&o.raw) == 0 {
            continue;
        }
        let kn = pattern_kit_number(&o.raw);
        if kn < 128 {
            used[kn as usize] = true;
        }
    }
    used
}

fn first_empty_pattern(dest: &Project) -> Result<u8, String> {
    for nr in 0..128u8 {
        if let Some(p) = find_raw(dest, OBJ_PATTERN, nr) {
            if count_pattern_trigs(&p.raw) == 0 {
                return Ok(nr);
            }
        }
    }
    Err("no empty destination pattern slot".into())
}

fn first_free_kit(dest: &Project) -> Result<u8, String> {
    let used = nonempty_pattern_kits(dest);
    for nr in 0..128u8 {
        if find_raw(dest, OBJ_KIT, nr).is_some() && !used[nr as usize] {
            return Ok(nr);
        }
    }
    Err("no free destination kit slot".into())
}

fn dest_kit_for_slot(dest: &Project, dest_pat: u8) -> Result<u8, String> {
    let used = nonempty_pattern_kits(dest);
    if find_raw(dest, OBJ_KIT, dest_pat).is_some() && !used[dest_pat as usize] {
        return Ok(dest_pat);
    }
    // Nonempty dest-base projects don't keep kit N free for pattern N.
    first_free_kit(dest)
}

/// Replace dest pattern `dest_pat` with an empty pattern object (trigs = 0).
/// Kits are left in place; unused kits become free for later PAT+KIT copies.
pub fn vacate_pattern(dest: &mut Project, dest_pat: u8) -> Result<(), String> {
    let Some(cur) = find_raw(dest, OBJ_PATTERN, dest_pat) else {
        return Err(format!("dest missing pattern {}", pattern_label(dest_pat)));
    };
    if count_pattern_trigs(&cur.raw) == 0 {
        return Ok(());
    }
    let empty_raw = dest
        .objects
        .iter()
        .find(|o| {
            o.obj_type == OBJ_PATTERN
                && o.obj_nr != u16::from(dest_pat)
                && count_pattern_trigs(&o.raw) == 0
        })
        .map(|o| o.raw.clone())
        .ok_or_else(|| "no empty dest pattern to use as a vacate donor".to_string())?;
    let dp = find_raw_mut(dest, OBJ_PATTERN, dest_pat).ok_or_else(|| {
        format!("dest missing pattern {}", pattern_label(dest_pat))
    })?;
    if dp.raw.len() != empty_raw.len() {
        return Err("dest pattern size mismatch while vacating".into());
    }
    dp.raw = empty_raw;
    dp.obj_nr = u16::from(dest_pat);
    encode_object(dp)?;
    Ok(())
}

fn apply_sample_remap(kit: &mut [u8], pattern: &mut [u8], remap: &[i16; 128]) -> u32 {
    for t in 0..KIT_TRACK_COUNT {
        let off = KIT_TRACKS + t * SOUND_RAW_SZ + SOUND_SAMPLE_NR;
        if off >= kit.len() {
            break;
        }
        let nr = kit[off];
        if (1..=127).contains(&nr) {
            let dest = remap[nr as usize];
            if dest >= 0 {
                kit[off] = dest as u8;
            }
        }
    }
    let mut plocks = 0u32;
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
                let dest = remap[v as usize];
                if dest >= 0 {
                    pattern[off + 2 + b] = dest as u8;
                    plocks += 1;
                }
            }
        }
    }
    plocks
}

/// Copy one source pattern + linked kit into dest (template). Mutates dest in place.
/// `dest_pat`: explicit pattern index (grid cell). `None` = first empty (legacy auto-pack).
pub fn copy_pattern_kit(
    src: &Project,
    dest: &mut Project,
    src_pat: u8,
    dest_pat: Option<u8>,
) -> Result<CopyReport, String> {
    let sp = find_raw(src, OBJ_PATTERN, src_pat)
        .ok_or_else(|| format!("{}: missing pattern {}", src.path, pattern_label(src_pat)))?;
    if sp.raw.len() != PATTERN_RAW_SZ {
        return Err(format!(
            "pattern raw size {} != {PATTERN_RAW_SZ} (not FW 1.70 v5?)",
            sp.raw.len()
        ));
    }
    let src_kit_nr = pattern_kit_number(&sp.raw);
    if src_kit_nr > 127 {
        return Err(format!(
            "{} {}: kit unsaved (0xFF) — save the kit on the Rytm before dumping",
            src.path,
            pattern_label(src_pat)
        ));
    }
    let sk = find_raw(src, OBJ_KIT, src_kit_nr).ok_or_else(|| {
        format!(
            "{}: missing kit {src_kit_nr} linked from {}",
            src.path,
            pattern_label(src_pat)
        )
    })?;
    if sk.raw.len() != KIT_RAW_SZ {
        return Err(format!("kit raw size {} != {KIT_RAW_SZ}", sk.raw.len()));
    }
    let ss =
        find_raw(src, OBJ_SETTINGS, 0).ok_or_else(|| format!("{}: missing settings", src.path))?;
    let explicit_dest = dest_pat.is_some();
    let dest_pat = match dest_pat {
        Some(n) => {
            let p = find_raw(dest, OBJ_PATTERN, n).ok_or_else(|| {
                format!("dest missing pattern {}", pattern_label(n))
            })?;
            if count_pattern_trigs(&p.raw) != 0 {
                return Err(format!(
                    "dest {} already has a pattern — pick an empty cell",
                    pattern_label(n)
                ));
            }
            n
        }
        None => first_empty_pattern(dest)?,
    };
    let dest_kit = if explicit_dest {
        dest_kit_for_slot(dest, dest_pat)?
    } else {
        first_free_kit(dest)?
    };

    let needed = needed_sample_slots(&sk.raw, &sp.raw);
    let mut remap = [-1i16; 128];
    let mut sample_map = Vec::new();
    let mut search_from = 1usize;

    // Settings live on dest object — clone rows then write back.
    let dest_settings_idx = dest
        .objects
        .iter()
        .position(|o| o.obj_type == OBJ_SETTINGS)
        .ok_or_else(|| "destination missing settings".to_string())?;
    if dest.objects[dest_settings_idx].raw.len() != SETTINGS_RAW_SZ {
        return Err("destination settings raw size mismatch".into());
    }

    for src_slot in needed {
        let fp = settings_row(&ss.raw, src_slot as usize)
            .ok_or_else(|| format!("src settings missing slot {src_slot}"))?;
        if slot_unused(fp) {
            return Err(format!(
                "{} kit {src_kit_nr} references sample slot {src_slot} but settings row is empty",
                src.path
            ));
        }
        let fp_owned = fp.to_vec();
        let dest_raw = &dest.objects[dest_settings_idx].raw;
        let (dest_slot, action) = if let Some(existing) = find_fingerprint(dest_raw, &fp_owned) {
            (existing, "REUSE")
        } else {
            let slot = next_free_slot(dest_raw, search_from)?;
            search_from = slot as usize + 1;
            (slot, "ALLOC")
        };
        if action == "ALLOC" {
            let row =
                settings_row_mut(&mut dest.objects[dest_settings_idx].raw, dest_slot as usize)
                    .unwrap();
            row.copy_from_slice(&fp_owned);
        }
        remap[src_slot as usize] = i16::from(dest_slot);
        sample_map.push(RemapLine {
            src_slot,
            dest_slot,
            action,
        });
    }

    let mut kit_raw = sk.raw.clone();
    let mut pat_raw = sp.raw.clone();
    let plock_rewrites = apply_sample_remap(&mut kit_raw, &mut pat_raw, &remap);
    pat_raw[PATTERN_KIT_NUMBER] = dest_kit;

    {
        let dk = find_raw_mut(dest, OBJ_KIT, dest_kit)
            .ok_or_else(|| format!("dest missing kit {dest_kit}"))?;
        if dk.raw.len() != kit_raw.len() {
            return Err("dest kit size mismatch".into());
        }
        dk.raw = kit_raw;
        dk.obj_nr = u16::from(dest_kit);
        encode_object(dk)?;
    }
    {
        let dp = find_raw_mut(dest, OBJ_PATTERN, dest_pat)
            .ok_or_else(|| format!("dest missing pattern {dest_pat}"))?;
        if dp.raw.len() != pat_raw.len() {
            return Err("dest pattern size mismatch".into());
        }
        dp.raw = pat_raw;
        dp.obj_nr = u16::from(dest_pat);
        encode_object(dp)?;
    }

    encode_object(&mut dest.objects[dest_settings_idx])?;

    Ok(CopyReport {
        src_path: src.path.clone(),
        src_pattern: src_pat,
        src_kit: src_kit_nr,
        src_kit_name: kit_name(&sk.raw),
        dest_pattern: dest_pat,
        dest_kit,
        trigs: count_pattern_trigs(&sp.raw),
        sample_map,
        plock_rewrites,
    })
}

pub fn format_report(
    template: &str,
    out: &str,
    copies: &[CopyReport],
    vacated: &[u8],
    check: &crate::project::ExportCheck,
    sources_unchanged: bool,
    sample_slots: usize,
) -> String {
    let mut s = String::new();
    s.push_str("rytm-builder compose\n");
    s.push_str(&format!("  template: {template}\n"));
    s.push_str(&format!("  output:   {out}\n"));
    s.push_str("  order:    settings, globals, kits, sounds, patterns, songs\n");
    s.push_str(&format!("  prefix:   {}\n", check.prefix.join(", ")));
    s.push_str(&format!(
        "  messages: {}  bytes: {}  md5: {}\n",
        check.messages, check.bytes, check.md5
    ));
    s.push_str(&format!(
        "  settings_first: {}  sources_unchanged: {}  sample_slots: {sample_slots}/128\n",
        check.settings_first, sources_unchanged
    ));
    s.push_str("  samples:  fingerprints only; files must already be on +Drive\n");
    if !vacated.is_empty() {
        let labels: Vec<String> = vacated.iter().copied().map(pattern_label).collect();
        s.push_str(&format!("  vacate:   {}\n", labels.join(", ")));
    }
    s.push('\n');
    for (i, c) in copies.iter().enumerate() {
        s.push_str(&format!(
            "[{}] {} {} + kit {} '{}'  ->  dest {} kit {}\n",
            i + 1,
            c.src_path,
            pattern_label(c.src_pattern),
            c.src_kit,
            c.src_kit_name,
            pattern_label(c.dest_pattern),
            c.dest_kit
        ));
        s.push_str(&format!(
            "    trigs={} plock_smp_nr_rewrites={}\n",
            c.trigs, c.plock_rewrites
        ));
        if c.sample_map.is_empty() {
            s.push_str("    samples: none\n");
        }
        for m in &c.sample_map {
            s.push_str(&format!(
                "    sample src {} -> dest {} ({})\n",
                m.src_slot, m.dest_slot, m.action
            ));
        }
        s.push('\n');
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn copy_spec_splits_path_and_pattern() {
        let s = parse_copy_spec("/tmp/x.syx:A03").unwrap();
        assert_eq!(s.src_path, "/tmp/x.syx");
        assert_eq!(s.pattern, 2);
        assert_eq!(s.dest, None);
        assert!(parse_copy_spec("nocolon").is_err());
        assert_eq!(parse_copy_spec("foo.syx:H16").unwrap().pattern, 127);
        let d = parse_copy_spec("/tmp/x.syx:A03:C04").unwrap();
        assert_eq!(d.src_path, "/tmp/x.syx");
        assert_eq!(d.pattern, 2);
        assert_eq!(d.dest, Some(35));
        let colon_path = parse_copy_spec("/tmp/weird:name.syx:A01").unwrap();
        assert_eq!(colon_path.src_path, "/tmp/weird:name.syx");
        assert_eq!(colon_path.pattern, 0);
        assert_eq!(colon_path.dest, None);
    }
}
