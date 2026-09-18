use crate::layout::*;
use crate::project::{
    count_pattern_trigs, count_smp_nr_plock_values, kit_sample_nrs, pattern_kit_number,
    sample_slots_used, Project,
};
use serde::Serialize;
use std::io::{self, Write};

fn out(line: impl std::fmt::Display) -> bool {
    writeln!(io::stdout(), "{line}").is_ok()
}

#[derive(Serialize, Clone)]
pub struct PatternRow {
    pub label: String,
    pub index: u8,
    pub kit: Option<u8>,
    pub kit_name: String,
    pub trigs: u32,
    pub sample_refs: usize,
    pub smp_nr_plocks: u32,
}

#[derive(Serialize, Clone)]
pub struct KitRow {
    pub index: u8,
    pub name: String,
    pub sample_refs: usize,
    pub sample_nrs: Vec<u8>,
}

#[derive(Serialize, Clone)]
pub struct Catalog {
    pub file: String,
    pub messages: usize,
    pub sample_slots_used: usize,
    pub patterns: Vec<PatternRow>,
    pub kits: Vec<KitRow>,
}

pub fn build_catalog(project: &Project) -> Catalog {
    let mut patterns = Vec::new();
    for nr in 0..128u8 {
        let Some(p) = project
            .objects
            .iter()
            .find(|o| o.obj_type == OBJ_PATTERN && o.obj_nr == u16::from(nr))
        else {
            continue;
        };
        let kn = pattern_kit_number(&p.raw);
        let trigs = count_pattern_trigs(&p.raw);
        if trigs == 0 {
            continue;
        }
        let mut kname = String::new();
        let mut sample_nrs: Vec<u8> = Vec::new();
        if kn < 128 {
            if let Some(k) = project
                .objects
                .iter()
                .find(|o| o.obj_type == OBJ_KIT && o.obj_nr == u16::from(kn))
            {
                kname = kit_name(&k.raw);
                sample_nrs = kit_sample_nrs(&k.raw)
                    .into_iter()
                    .filter(|(_, n)| *n > 0)
                    .map(|(_, n)| n)
                    .collect();
            }
        }
        let unique = {
            let mut v = sample_nrs.clone();
            v.sort_unstable();
            v.dedup();
            v.len()
        };
        patterns.push(PatternRow {
            label: pattern_label(nr),
            index: nr,
            kit: if kn < 128 { Some(kn) } else { None },
            kit_name: kname,
            trigs,
            sample_refs: unique,
            smp_nr_plocks: count_smp_nr_plock_values(&p.raw),
        });
    }

    let mut kits = Vec::new();
    for nr in 0..128u8 {
        let Some(k) = project
            .objects
            .iter()
            .find(|o| o.obj_type == OBJ_KIT && o.obj_nr == u16::from(nr))
        else {
            continue;
        };
        let name = kit_name(&k.raw);
        let samples: Vec<u8> = kit_sample_nrs(&k.raw)
            .into_iter()
            .filter(|(_, n)| *n > 0)
            .map(|(_, n)| n)
            .collect();
        if name.is_empty() && samples.is_empty() {
            continue;
        }
        let unique = {
            let mut v = samples.clone();
            v.sort_unstable();
            v.dedup();
            v.len()
        };
        kits.push(KitRow {
            index: nr,
            name,
            sample_refs: unique,
            sample_nrs: samples,
        });
    }

    Catalog {
        file: project.path.clone(),
        messages: project.objects.len(),
        sample_slots_used: sample_slots_used(project),
        patterns,
        kits,
    }
}

pub fn print_catalog(project: &Project) {
    let cat = build_catalog(project);
    if !out(format!("FILE {}", cat.file)) {
        return;
    }
    if !out(format!("MSGS {}", cat.messages)) {
        return;
    }
    if !out(format!("SAMPLE_SLOTS_USED {}/128", cat.sample_slots_used)) {
        return;
    }
    if !out("--- patterns ---") {
        return;
    }
    for p in &cat.patterns {
        let kit_s = match p.kit {
            None => "unsaved".into(),
            Some(kn) => format!("{kn} '{}'", p.kit_name),
        };
        if !out(format!(
            "  {} idx={:3} kit={kit_s} trigs={} sample_refs={} smp_nr_plocks={}",
            p.label, p.index, p.trigs, p.sample_refs, p.smp_nr_plocks
        )) {
            return;
        }
    }
    if !out(format!("NONEMPTY_PATTERNS {}", cat.patterns.len())) {
        return;
    }
    if !out("--- kits with names or sample refs ---") {
        return;
    }
    for k in &cat.kits {
        if !out(format!(
            "  kit {:3} '{}' sample_refs={} sample_nrs={:?}",
            k.index, k.name, k.sample_refs, k.sample_nrs
        )) {
            return;
        }
    }
}

pub fn print_catalog_json(project: &Project) -> Result<(), String> {
    let cat = build_catalog(project);
    let json = serde_json::to_string_pretty(&cat).map_err(|e| format!("json: {e}"))?;
    if !out(json) {
        return Err("broken pipe".into());
    }
    Ok(())
}
