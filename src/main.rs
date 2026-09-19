mod catalog;
mod compose;
mod layout;
mod project;

use compose::{
    copy_kit, copy_pattern_kit, format_edits_lines, format_report, parse_copy_spec, vacate_kit,
    vacate_pattern,
};
use layout::parse_pattern_index;
use project::{
    collect_edits, load_project, md5_file, sample_slots_used, write_objects_syx,
    write_settings_first,
};
use std::env;
use std::path::{Path, PathBuf};

fn usage() -> ! {
    eprintln!(
        "rytm-builder — compose a fresh Analog Rytm project .syx (no overwrite, no MIDI)\n\n\
         rytm-builder catalog [--json] <dump.syx>\n\
         rytm-builder compose --template <base.syx> --out <new.syx> --copy <dump.syx:A03> [...]\n\
             [--copy <dump.syx:A03:C04>] [--vacate A03]\n\
             [--copy-kit <dump.syx:A03:C04>] [--vacate-kit A03]\n\
             [--edits-out <edits.syx>] [--report <report.txt>]\n\
             Dest C04 leaves A01 empty. PATH:PATTERN still auto-packs first empty slot.\n\
             --vacate empties a dest pattern (move away / differential). PAT+KIT copy only.\n\
             --copy-kit overwrites dest kit C04 (A01–H16 = kit 0–127). No pattern write.\n\
             Occupied dest kits are overwritten so patterns already using that kit pick up\n\
             the new analog/samples. --vacate-kit empties a dest kit object.\n\
             --out writes a whole-project .syx (restore into empty/disposable RAM).\n\
             --edits-out writes settings + changed kits/patterns only (restore onto dest-base in RAM).\n\
             This tool never talks USB/MIDI.\n"
    );
    std::process::exit(2);
}

fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

fn take_flag(args: &mut Vec<String>, name: &str) -> Option<String> {
    if let Some(i) = args.iter().position(|a| a == name) {
        args.remove(i);
        if i >= args.len() {
            eprintln!("missing value after {name}");
            usage();
        }
        return Some(args.remove(i));
    }
    None
}

fn take_all(args: &mut Vec<String>, name: &str) -> Vec<String> {
    let mut out = Vec::new();
    while let Some(v) = take_flag(args, name) {
        out.push(v);
    }
    out
}

fn run() -> Result<(), String> {
    let mut args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() {
        usage();
    }
    let cmd = args.remove(0);
    match cmd.as_str() {
        "catalog" => {
            let json = args.iter().any(|a| a == "--json");
            args.retain(|a| a != "--json");
            let dump = args.first().ok_or("catalog needs a dump path")?;
            let p = load_project(&PathBuf::from(dump))?;
            if json {
                catalog::print_catalog_json(&p)?;
            } else {
                catalog::print_catalog(&p);
            }
        }
        "compose" => {
            let template =
                take_flag(&mut args, "--template").ok_or("compose needs --template <empty.syx>")?;
            let out = take_flag(&mut args, "--out");
            let edits_out = take_flag(&mut args, "--edits-out");
            let report = take_flag(&mut args, "--report");
            let copies = take_all(&mut args, "--copy");
            let vacates = take_all(&mut args, "--vacate");
            let kit_copies = take_all(&mut args, "--copy-kit");
            let kit_vacates = take_all(&mut args, "--vacate-kit");
            if !args.is_empty() {
                return Err(format!("unexpected args: {args:?}"));
            }
            if copies.is_empty()
                && vacates.is_empty()
                && kit_copies.is_empty()
                && kit_vacates.is_empty()
            {
                return Err(
                    "compose needs at least one --copy, --vacate, --copy-kit, or --vacate-kit"
                        .into(),
                );
            }
            if out.is_none() && edits_out.is_none() {
                return Err("compose needs --out and/or --edits-out".into());
            }
            let template = PathBuf::from(template);
            let out = out.map(PathBuf::from);
            let edits_out = edits_out.map(PathBuf::from);
            if !template.is_file() {
                return Err(format!("template not found: {}", template.display()));
            }
            if let Some(p) = &out {
                if p.exists() {
                    return Err(format!(
                        "output already exists: {} (choose a new name)",
                        p.display()
                    ));
                }
            }
            if let Some(p) = &edits_out {
                if p.exists() {
                    return Err(format!(
                        "edits output already exists: {} (choose a new name)",
                        p.display()
                    ));
                }
            }
            let specs: Vec<_> = copies
                .iter()
                .map(|c| parse_copy_spec(c))
                .collect::<Result<_, _>>()?;
            let kit_specs: Vec<_> = kit_copies
                .iter()
                .map(|c| parse_copy_spec(c))
                .collect::<Result<_, _>>()?;
            let mut watched: Vec<PathBuf> = vec![template.clone()];
            for spec in &specs {
                watched.push(PathBuf::from(&spec.src_path));
            }
            for spec in &kit_specs {
                watched.push(PathBuf::from(&spec.src_path));
            }
            let before = snapshot_files(&watched)?;
            let orig = load_project(&template)?;
            let mut dest = orig.clone();
            dest.path = orig.path.clone();
            let mut vacated = Vec::new();
            for v in &vacates {
                let idx = parse_pattern_index(v)?;
                vacate_pattern(&mut dest, idx)?;
                vacated.push(idx);
            }
            let mut vacated_kits = Vec::new();
            for v in &kit_vacates {
                let idx = parse_pattern_index(v)?;
                vacate_kit(&mut dest, idx)?;
                vacated_kits.push(idx);
            }
            let mut reports = Vec::new();
            for spec in &specs {
                let src = load_project(Path::new(&spec.src_path))?;
                let r = copy_pattern_kit(&src, &mut dest, spec.pattern, spec.dest)?;
                reports.push(r);
            }
            let mut kit_reports = Vec::new();
            for spec in &kit_specs {
                let src = load_project(Path::new(&spec.src_path))?;
                let r = copy_kit(&src, &mut dest, spec.pattern, spec.dest)?;
                kit_reports.push(r);
            }
            let mut out_label = String::from("(none)");
            let mut check_opt = None;
            if let Some(p) = &out {
                let check = write_settings_first(&dest, p)?;
                out_label = p.display().to_string();
                check_opt = Some(check);
            }
            let mut edits_block = String::new();
            let mut edits_check = None;
            if let Some(p) = &edits_out {
                let objs = collect_edits(&orig, &dest)?;
                let echeck = write_objects_syx(&objs, p)?;
                edits_block = format_edits_lines(&p.display().to_string(), &echeck, &objs);
                edits_check = Some(echeck);
            }
            let after = snapshot_files(&watched)?;
            let sources_unchanged = before == after;
            if !sources_unchanged {
                return Err(
                    "a source or template file changed on disk during compose — originals must stay untouched"
                        .into(),
                );
            }
            let check_ref = check_opt
                .as_ref()
                .or(edits_check.as_ref())
                .expect("compose needs --out and/or --edits-out");
            let mut text = format_report(
                &template.display().to_string(),
                &out_label,
                &reports,
                &vacated,
                &kit_reports,
                &vacated_kits,
                check_ref,
                sources_unchanged,
                sample_slots_used(&dest),
            );
            if !edits_block.is_empty() {
                text.push_str(&edits_block);
                text.push('\n');
            }
            print!("{text}");
            if let Some(rp) = report {
                let rp = PathBuf::from(rp);
                if rp.exists() {
                    return Err(format!("report path exists: {}", rp.display()));
                }
                std::fs::write(&rp, &text).map_err(|e| format!("write report: {e}"))?;
            }
            if let Some(p) = &out {
                println!(
                    "OK wrote {} (whole project, settings-first, md5 {}). Restore into empty/disposable RAM; samples must already be on +Drive. No USB from this tool.",
                    p.display(),
                    check_opt.as_ref().map(|c| c.md5.as_str()).unwrap_or("?")
                );
            }
            if let Some(p) = &edits_out {
                println!(
                    "OK wrote {} (edits). Restore onto dest-base already in RAM. No USB from this tool.",
                    p.display()
                );
            }
        }
        "-h" | "--help" | "help" => usage(),
        other => {
            eprintln!("unknown command {other}");
            usage();
        }
    }
    Ok(())
}

fn snapshot_files(paths: &[PathBuf]) -> Result<Vec<(String, String)>, String> {
    let mut out = Vec::new();
    for p in paths {
        out.push((p.display().to_string(), md5_file(p)?));
    }
    Ok(out)
}
