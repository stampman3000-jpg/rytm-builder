use crate::layout::*;
use crate::project::{
    count_pattern_trigs, count_smp_nr_plock_values, kit_sample_nrs, pattern_kit_number,
    sample_slots_used, Project,
};
use std::io::{self, Write};

fn out(line: impl std::fmt::Display) -> bool {
    writeln!(io::stdout(), "{line}").is_ok()
}

pub fn print_catalog(project: &Project) {
    if !out(format!("FILE {}", project.path)) {
        return;
    }
    if !out(format!("MSGS {}", project.objects.len())) {
        return;
    }
    if !out(format!(
        "SAMPLE_SLOTS_USED {}/128",
        sample_slots_used(project)
    )) {
        return;
    }

    if !out("--- patterns ---") {
        return;
    }
    let mut nonempty = 0u32;
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
        let mut kname = String::new();
        if kn < 128 {
            if let Some(k) = project
                .objects
                .iter()
                .find(|o| o.obj_type == OBJ_KIT && o.obj_nr == u16::from(kn))
            {
                kname = kit_name(&k.raw);
            }
        }
        let empty = trigs == 0;
        if empty {
            continue;
        }
        nonempty += 1;
        let kit_s = if kn == 0xFF {
            "unsaved".into()
        } else {
            format!("{kn} '{kname}'")
        };
        let plocks = count_smp_nr_plock_values(&p.raw);
        if !out(format!(
            "  {} idx={nr:3} kit={kit_s} trigs={trigs} smp_nr_plocks={plocks}",
            pattern_label(nr)
        )) {
            return;
        }
    }
    if !out(format!("NONEMPTY_PATTERNS {nonempty}")) {
        return;
    }

    if !out("--- kits with names or sample refs ---") {
        return;
    }
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
        if !out(format!("  kit {nr:3} '{name}' sample_nrs={samples:?}")) {
            return;
        }
    }
}
