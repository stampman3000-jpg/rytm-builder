mod catalog;
mod compose;
mod layout;
mod project;

use compose::{copy_pattern_kit, format_report, parse_copy_spec};
use project::{load_project, md5_file, sample_slots_used, write_settings_first};
use std::env;
use std::path::{Path, PathBuf};

fn usage() -> ! {
    eprintln!(
        "rytm-builder — compose a fresh Analog Rytm project .syx (no overwrite, no MIDI)\n\n\
         rytm-builder catalog [--json] <dump.syx>\n\
         rytm-builder compose --template <empty.syx> --out <new.syx> --copy <dump.syx:A03> [...]\n\
             [--copy <dump.syx:A03:C04>] [--report <report.txt>]\n\
             Dest C04 leaves A01 empty. PATH:PATTERN still auto-packs first empty slot.\n"
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
            let out = take_flag(&mut args, "--out").ok_or("compose needs --out <new.syx>")?;
            let report = take_flag(&mut args, "--report");
            let copies = take_all(&mut args, "--copy");
            if !args.is_empty() {
                return Err(format!("unexpected args: {args:?}"));
            }
            if copies.is_empty() {
                return Err("compose needs at least one --copy PATH:PATTERN".into());
            }
            let template = PathBuf::from(template);
            let out = PathBuf::from(out);
            if !template.is_file() {
                return Err(format!("template not found: {}", template.display()));
            }
            if out.exists() {
                return Err(format!(
                    "output already exists: {} (choose a new name)",
                    out.display()
                ));
            }
            let specs: Vec<_> = copies
                .iter()
                .map(|c| parse_copy_spec(c))
                .collect::<Result<_, _>>()?;
            let mut watched: Vec<PathBuf> = vec![template.clone()];
            for spec in &specs {
                watched.push(PathBuf::from(&spec.src_path));
            }
            let before = snapshot_files(&watched)?;
            let mut dest = load_project(&template)?;
            let mut reports = Vec::new();
            for spec in &specs {
                let src = load_project(Path::new(&spec.src_path))?;
                let r = copy_pattern_kit(&src, &mut dest, spec.pattern, spec.dest)?;
                reports.push(r);
            }
            let check = write_settings_first(&dest, &out)?;
            let after = snapshot_files(&watched)?;
            let sources_unchanged = before == after;
            if !sources_unchanged {
                return Err(
                    "a source or template file changed on disk during compose — originals must stay untouched"
                        .into(),
                );
            }
            let text = format_report(
                &template.display().to_string(),
                &out.display().to_string(),
                &reports,
                &check,
                sources_unchanged,
                sample_slots_used(&dest),
            );
            print!("{text}");
            if let Some(rp) = report {
                let rp = PathBuf::from(rp);
                if rp.exists() {
                    return Err(format!("report path exists: {}", rp.display()));
                }
                std::fs::write(&rp, &text).map_err(|e| format!("write report: {e}"))?;
            }
            println!(
                "OK wrote {} (settings-first, md5 {}). Restore into an empty/disposable project; samples must already be on +Drive.",
                out.display(),
                check.md5
            );
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
