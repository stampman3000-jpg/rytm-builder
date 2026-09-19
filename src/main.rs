use rytm_builder::catalog;
use rytm_builder::compose::{compose_session, parse_copy_spec, ComposeSession};
use rytm_builder::layout::parse_pattern_index;
use rytm_builder::project::load_project;
use std::env;
use std::path::PathBuf;

fn usage() -> ! {
    eprintln!(
        "rytm-builder — compose a fresh Analog Rytm project .syx (no overwrite, no MIDI)\n\n\
         rytm-builder catalog [--json] <dump.syx>\n\
         rytm-builder compose --template <base.syx> --out <new.syx> --copy <dump.syx:A03> [...]\n\
             [--copy <dump.syx:A03:C04>] [--vacate A03]\n\
             [--copy-kit <dump.syx:A03:C04>] [--vacate-kit A03]\n\
             [--copy-pattern <dump.syx:A03:C04>]\n\
             [--edits-out <edits.syx>] [--report <report.txt>]\n\
             Dest C04 leaves A01 empty. PATH:PATTERN still auto-packs first empty slot.\n\
             --vacate empties a dest pattern (move away / differential).\n\
             --copy-kit overwrites dest kit C04 (A01–H16 = kit 0–127). No pattern write.\n\
             Occupied dest kits are overwritten so patterns already using that kit pick up\n\
             the new analog/samples. --vacate-kit empties a dest kit object.\n\
             --copy-pattern overwrites dest pattern C04 and keeps that slot’s kit number.\n\
             Occupied dest patterns are overwritten. Kits are not written.\n\
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
            let pattern_copies = take_all(&mut args, "--copy-pattern");
            if !args.is_empty() {
                return Err(format!("unexpected args: {args:?}"));
            }
            let specs: Vec<_> = copies
                .iter()
                .map(|c| parse_copy_spec(c))
                .collect::<Result<_, _>>()?;
            let kit_specs: Vec<_> = kit_copies
                .iter()
                .map(|c| parse_copy_spec(c))
                .collect::<Result<_, _>>()?;
            let pattern_specs: Vec<_> = pattern_copies
                .iter()
                .map(|c| parse_copy_spec(c))
                .collect::<Result<_, _>>()?;
            let vacate_idx: Vec<u8> = vacates
                .iter()
                .map(|v| parse_pattern_index(v))
                .collect::<Result<_, _>>()?;
            let kit_vacate_idx: Vec<u8> = kit_vacates
                .iter()
                .map(|v| parse_pattern_index(v))
                .collect::<Result<_, _>>()?;
            let outcome = compose_session(ComposeSession {
                template: PathBuf::from(template),
                out: out.map(PathBuf::from),
                edits_out: edits_out.map(PathBuf::from),
                report: report.map(PathBuf::from),
                copies: specs,
                vacates: vacate_idx,
                kit_copies: kit_specs,
                kit_vacates: kit_vacate_idx,
                pattern_copies: pattern_specs,
            })?;
            print!("{}", outcome.text);
            if let Some(p) = &outcome.out {
                println!(
                    "OK wrote {} (whole project, settings-first, md5 {}). Restore into empty/disposable RAM; samples must already be on +Drive. No USB from this tool.",
                    p.display(),
                    outcome.out_md5.as_deref().unwrap_or("?")
                );
            }
            if let Some(p) = &outcome.edits_out {
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
