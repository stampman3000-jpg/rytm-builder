//! App-owned library, dest-base, and UI compose. No USB/MIDI.

use crate::catalog::{build_catalog, Catalog};
use crate::compose::{compose_session, ComposeSession, CopySpec};
use crate::layout::parse_pattern_index;
use crate::project::load_project;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const DEST_BASE_PATH: &str = "@dest";
const SAFE_NAME: &str = r"^[A-Za-z0-9._-]{1,80}\.syx$";

static BAKED_TEMPLATE: OnceLock<PathBuf> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DumpInfo {
    pub name: String,
    pub path: String,
    pub bytes: u64,
    pub kind: DumpKind,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DumpKind {
    Library,
    Composed,
}

#[derive(Debug, Clone, Serialize)]
pub struct LibraryState {
    pub dumps: Vec<DumpInfo>,
    pub template: TemplateInfo,
}

#[derive(Debug, Clone, Serialize)]
pub struct TemplateInfo {
    pub kind: TemplateKind,
    pub name: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TemplateKind {
    Baked,
    Custom,
}

#[derive(Debug, Clone, Serialize)]
pub struct DestTemplate {
    pub kind: TemplateKind,
    pub name: String,
    pub catalog: Catalog,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ImportFile {
    pub name: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    pub imported: Vec<String>,
    pub skipped: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiCopy {
    pub path: String,
    pub pattern: Option<String>,
    pub kit: Option<String>,
    pub dest: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiComposeRequest {
    pub template: Option<TemplateKind>,
    pub name: String,
    pub mode: Option<String>,
    pub copies: Option<Vec<UiCopy>>,
    pub vacates: Option<Vec<String>>,
    pub kit_copies: Option<Vec<UiCopy>>,
    pub kit_vacates: Option<Vec<String>>,
    pub pattern_copies: Option<Vec<UiCopy>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComposeResult {
    pub out: String,
    pub report: String,
    pub mode: String,
    pub text: String,
    pub app_path: String,
    pub suggested_path: String,
}

pub fn set_baked_template(path: PathBuf) {
    let _ = BAKED_TEMPLATE.set(path);
}

pub fn app_home() -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("RYTM_APP_HOME") {
        return Ok(PathBuf::from(p));
    }
    let home = home::home_dir().ok_or("cannot find home directory")?;
    Ok(home.join("Library/Application Support/rytm-builder"))
}

pub fn library_dir() -> Result<PathBuf, String> {
    Ok(app_home()?.join("library"))
}

pub fn exports_dir() -> Result<PathBuf, String> {
    Ok(app_home()?.join("exports"))
}

pub fn user_template_path() -> Result<PathBuf, String> {
    Ok(app_home()?.join("template-override.syx"))
}

pub fn user_template_label_path() -> Result<PathBuf, String> {
    Ok(app_home()?.join("template-override-name.txt"))
}

pub fn ensure_app_dirs() -> Result<(), String> {
    std::fs::create_dir_all(library_dir()?).map_err(|e| format!("library dir: {e}"))?;
    std::fs::create_dir_all(exports_dir()?).map_err(|e| format!("exports dir: {e}"))?;
    Ok(())
}

pub fn baked_template_path() -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("RYTM_TEMPLATE") {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Ok(p);
        }
    }
    if let Some(p) = BAKED_TEMPLATE.get() {
        if p.is_file() {
            return Ok(p.clone());
        }
    }
    let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("web/templates/Untitled-4.syx");
    if repo.is_file() {
        return Ok(repo);
    }
    Err("baked empty template is missing (Untitled-4.syx)".into())
}

pub fn downloads_dir() -> Result<PathBuf, String> {
    if let Ok(p) = std::env::var("RYTM_DOWNLOADS") {
        return Ok(PathBuf::from(p));
    }
    let home = home::home_dir().ok_or("cannot find home directory")?;
    Ok(home.join("Downloads"))
}

fn empty_dest_catalog(file: &str) -> Catalog {
    Catalog {
        file: file.to_string(),
        messages: 0,
        sample_slots_used: 0,
        patterns: Vec::new(),
        kits: Vec::new(),
    }
}

pub fn active_template() -> Result<(TemplateKind, PathBuf, String), String> {
    let custom = user_template_path()?;
    if custom.is_file() {
        let mut name = String::from("Dropped dest base");
        if let Ok(label) = std::fs::read_to_string(user_template_label_path()?) {
            let label = label.trim();
            if !label.is_empty() {
                name = label.to_string();
            }
        }
        return Ok((TemplateKind::Custom, custom, name));
    }
    Ok((
        TemplateKind::Baked,
        baked_template_path()?,
        "Baked empty".into(),
    ))
}

pub fn catalog_dest() -> Result<DestTemplate, String> {
    let (kind, path, name) = active_template()?;
    if kind == TemplateKind::Baked {
        return Ok(DestTemplate {
            kind,
            name: name.clone(),
            catalog: empty_dest_catalog(&name),
        });
    }
    let project = load_project(&path)?;
    let mut catalog = build_catalog(&project);
    catalog.file = name.clone();
    Ok(DestTemplate {
        kind,
        name,
        catalog,
    })
}

pub fn list_library() -> Result<LibraryState, String> {
    ensure_app_dirs()?;
    let dir = library_dir()?;
    let mut names: Vec<String> = std::fs::read_dir(&dir)
        .map_err(|e| format!("read library: {e}"))?
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.to_lowercase().ends_with(".syx"))
        .collect();
    names.sort();
    let dumps = names
        .into_iter()
        .map(|name| {
            let p = dir.join(&name);
            let bytes = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            DumpInfo {
                kind: dump_kind(&name),
                path: name.clone(),
                bytes,
                name,
            }
        })
        .collect();
    let (kind, _, name) = active_template()?;
    Ok(LibraryState {
        dumps,
        template: TemplateInfo { kind, name },
    })
}

pub fn catalog_dump(name: &str) -> Result<Catalog, String> {
    let resolved = resolve_library_file(name)?;
    let project = load_project(&resolved)?;
    let mut catalog = build_catalog(&project);
    catalog.file = Path::new(&catalog.file)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or(catalog.file);
    Ok(catalog)
}

pub fn import_library(files: Vec<ImportFile>) -> Result<ImportResult, String> {
    ensure_app_dirs()?;
    if files.is_empty() {
        return Err("drop one or more .syx files".into());
    }
    let dir = library_dir()?;
    let mut imported = Vec::new();
    let mut skipped = Vec::new();
    for item in files {
        let name = match safe_syx_name(&item.name) {
            Ok(n) => n,
            Err(e) => {
                skipped.push(e);
                continue;
            }
        };
        let dest = dir.join(&name);
        if dest.exists() {
            skipped.push(format!("{name} already in library"));
            continue;
        }
        if item.bytes.len() < 1000 {
            skipped.push(format!("{name} too small to be a whole-project dump"));
            continue;
        }
        std::fs::write(&dest, &item.bytes).map_err(|e| format!("write {name}: {e}"))?;
        imported.push(name);
    }
    if imported.is_empty() && !skipped.is_empty() {
        return Err(skipped.join("; "));
    }
    Ok(ImportResult { imported, skipped })
}

pub fn set_dest_base(file: ImportFile) -> Result<DestTemplate, String> {
    ensure_app_dirs()?;
    let name = safe_syx_name(&file.name)?;
    if file.bytes.len() < 1000 {
        return Err("file too small to be a whole-project dump".into());
    }
    std::fs::write(user_template_path()?, &file.bytes)
        .map_err(|e| format!("write dest base: {e}"))?;
    std::fs::write(user_template_label_path()?, name)
        .map_err(|e| format!("write dest base name: {e}"))?;
    catalog_dest()
}

pub fn reset_dest_base() -> Result<DestTemplate, String> {
    let custom = user_template_path()?;
    let label = user_template_label_path()?;
    if custom.exists() {
        std::fs::remove_file(&custom).map_err(|e| format!("reset dest base: {e}"))?;
    }
    if label.exists() {
        std::fs::remove_file(&label).map_err(|e| format!("reset dest base label: {e}"))?;
    }
    let _ = baked_template_path()?;
    catalog_dest()
}

pub fn compose_ui(req: UiComposeRequest) -> Result<ComposeResult, String> {
    ensure_app_dirs()?;
    let copies = req.copies.unwrap_or_default();
    let vacates = req.vacates.unwrap_or_default();
    let kit_copies = req.kit_copies.unwrap_or_default();
    let kit_vacates = req.kit_vacates.unwrap_or_default();
    let pattern_copies = req.pattern_copies.unwrap_or_default();
    let mode = if req.mode.as_deref() == Some("edits") {
        "edits"
    } else {
        "project"
    };
    if req.name.trim().is_empty()
        || (copies.is_empty()
            && vacates.is_empty()
            && kit_copies.is_empty()
            && kit_vacates.is_empty()
            && pattern_copies.is_empty())
    {
        return Err("need output name and at least one copy or vacate".into());
    }
    let template = resolve_template_file(req.template)?;
    let stem = strip_syx_stem(&req.name);
    let out_name = if mode == "edits" {
        format!("{stem}__edits")
    } else {
        stem.to_string()
    };
    let out = new_export_path(&out_name)?;
    let report = out.with_extension("txt");
    let copy_specs = copies
        .iter()
        .map(|c| ui_copy_to_spec(c, &template, false))
        .collect::<Result<Vec<_>, _>>()?;
    let kit_specs = kit_copies
        .iter()
        .map(|c| ui_copy_to_spec(c, &template, true))
        .collect::<Result<Vec<_>, _>>()?;
    let pattern_specs = pattern_copies
        .iter()
        .map(|c| ui_copy_to_spec(c, &template, false))
        .collect::<Result<Vec<_>, _>>()?;
    let vacate_idx = vacates
        .iter()
        .map(|s| parse_pattern_index(s))
        .collect::<Result<Vec<_>, _>>()?;
    let kit_vacate_idx = kit_vacates
        .iter()
        .map(|s| parse_pattern_index(s))
        .collect::<Result<Vec<_>, _>>()?;
    let mut job = ComposeSession {
        template,
        out: None,
        edits_out: None,
        report: Some(report.clone()),
        copies: copy_specs,
        vacates: vacate_idx,
        kit_copies: kit_specs,
        kit_vacates: kit_vacate_idx,
        pattern_copies: pattern_specs,
    };
    if mode == "edits" {
        job.edits_out = Some(out.clone());
    } else {
        job.out = Some(out.clone());
    }
    let outcome = compose_session(job)?;
    let file = format!("{out_name}.syx");
    let suggested = downloads_dir()?.join(&file);
    Ok(ComposeResult {
        out: file,
        report: format!("{out_name}.txt"),
        mode: mode.to_string(),
        text: scrub_paths(&outcome.text),
        app_path: out.display().to_string(),
        suggested_path: suggested.display().to_string(),
    })
}

pub fn save_export_as(source_name: &str, dest: &str) -> Result<String, String> {
    let src = resolve_export_file(source_name)?;
    let dest = PathBuf::from(dest);
    if dest.as_os_str().is_empty() {
        return Err("save path is empty".into());
    }
    if let Some(parent) = dest.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| format!("create save folder: {e}"))?;
        }
    }
    std::fs::copy(&src, &dest).map_err(|e| format!("save .syx: {e}"))?;
    Ok(dest.display().to_string())
}

fn ui_copy_to_spec(c: &UiCopy, template: &Path, kit: bool) -> Result<CopySpec, String> {
    let slot = if kit {
        c.kit.as_deref().ok_or("each kit copy needs a kit slot")?
    } else {
        c.pattern
            .as_deref()
            .ok_or("each copy needs a pattern")?
    };
    if c.dest.is_empty() {
        return Err("each copy needs a dest slot (A01–H16)".into());
    }
    let src = if c.path == DEST_BASE_PATH || c.path == "__dest__" {
        template.to_path_buf()
    } else {
        resolve_library_file(&c.path)?
    };
    Ok(CopySpec {
        src_path: src.display().to_string(),
        pattern: parse_pattern_index(slot)?,
        dest: Some(parse_pattern_index(&c.dest)?),
    })
}

pub fn dump_kind(name: &str) -> DumpKind {
    let n = name.to_ascii_lowercase();
    if n.starts_with("fresh") || n.starts_with("gatec") || n.contains("__") {
        DumpKind::Composed
    } else {
        DumpKind::Library
    }
}

fn safe_syx_name(name: &str) -> Result<String, String> {
    let base = Path::new(name)
        .file_name()
        .ok_or("missing file name")?
        .to_string_lossy()
        .replace(char::is_whitespace, "_");
    if !regex_safe_name(&base) {
        return Err(
            "file name may only use letters, numbers, dot, dash, underscore, and .syx".into(),
        );
    }
    Ok(base)
}

fn regex_safe_name(name: &str) -> bool {
    let _ = SAFE_NAME;
    let bytes = name.as_bytes();
    if bytes.len() < 5 || bytes.len() > 84 {
        return false;
    }
    if !name.to_ascii_lowercase().ends_with(".syx") {
        return false;
    }
    name.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

fn real_or_self(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

fn under_dir(file: &Path, dir: &Path) -> bool {
    let d = real_or_self(dir);
    let f = real_or_self(file);
    f == d || f.starts_with(&d)
}

pub fn resolve_library_file(name_or_path: &str) -> Result<PathBuf, String> {
    ensure_app_dirs()?;
    let name = Path::new(name_or_path)
        .file_name()
        .ok_or("missing file name")?
        .to_string_lossy()
        .into_owned();
    let p = library_dir()?.join(&name);
    if !p.exists() {
        return Err(format!("not in library: {name}"));
    }
    let resolved = std::fs::canonicalize(&p).map_err(|e| format!("{name}: {e}"))?;
    if !under_dir(&resolved, &library_dir()?) {
        return Err("path is outside the library".into());
    }
    Ok(resolved)
}

fn resolve_template_file(kind: Option<TemplateKind>) -> Result<PathBuf, String> {
    match kind.unwrap_or(active_template()?.0) {
        TemplateKind::Baked => {
            let baked = baked_template_path()?;
            std::fs::canonicalize(&baked).map_err(|_| "baked template missing".into())
        }
        TemplateKind::Custom => {
            let custom = user_template_path()?;
            if !custom.exists() {
                return Err("no dropped dest base".into());
            }
            std::fs::canonicalize(&custom).map_err(|_| "no dropped dest base".into())
        }
    }
}

fn strip_syx_stem(name: &str) -> &str {
    let t = name.trim();
    if t.len() >= 4 && t[t.len() - 4..].eq_ignore_ascii_case(".syx") {
        t[..t.len() - 4].trim()
    } else {
        t
    }
}

fn new_export_path(stem: &str) -> Result<PathBuf, String> {
    ensure_app_dirs()?;
    if stem.is_empty()
        || stem.len() > 80
        || !stem
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
    {
        return Err("output name may only use letters, numbers, dot, dash, underscore".into());
    }
    let dir = std::fs::canonicalize(exports_dir()?).map_err(|e| format!("exports: {e}"))?;
    let out = dir.join(format!("{stem}.syx"));
    if !out.starts_with(&dir) {
        return Err("path is outside the export folder".into());
    }
    if out.exists() {
        return Err(format!(
            "output already exists: {} — pick a new name",
            out.file_name().unwrap().to_string_lossy()
        ));
    }
    Ok(out)
}

fn resolve_export_file(name: &str) -> Result<PathBuf, String> {
    ensure_app_dirs()?;
    let base = safe_syx_name(name)?;
    let p = exports_dir()?.join(&base);
    if !p.exists() {
        return Err(format!("not an export: {base}"));
    }
    let resolved = std::fs::canonicalize(&p).map_err(|e| format!("{base}: {e}"))?;
    let dir = std::fs::canonicalize(exports_dir()?).map_err(|e| format!("exports: {e}"))?;
    if resolved != dir && !resolved.starts_with(&dir) {
        return Err("path is outside the export folder".into());
    }
    Ok(resolved)
}

pub fn scrub_paths(text: &str) -> String {
    let mut out = text.to_string();
    if let Some(home) = home::home_dir() {
        out = out.replace(&home.display().to_string(), "~");
    }
    let repo = env!("CARGO_MANIFEST_DIR");
    out = out.replace(repo, "rytm-builder");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_names_reject_spaces_and_paths() {
        assert!(safe_syx_name("Untitled-1.syx").is_ok());
        assert!(safe_syx_name("../x.syx").is_ok()); // basename only
        assert_eq!(safe_syx_name("../x.syx").unwrap(), "x.syx");
        assert!(safe_syx_name("bad name.syx").is_ok()); // whitespace becomes _
        assert_eq!(safe_syx_name("bad name.syx").unwrap(), "bad_name.syx");
        assert!(safe_syx_name("nope.txt").is_err());
    }

    #[test]
    fn dump_kind_marks_edits() {
        assert!(matches!(dump_kind("Untitled.syx"), DumpKind::Library));
        assert!(matches!(dump_kind("Fresh_from_picks.syx"), DumpKind::Composed));
        assert!(matches!(dump_kind("x__edits.syx"), DumpKind::Composed));
    }

    #[test]
    fn baked_empty_template_is_in_the_repo() {
        let p = baked_template_path().expect("baked template path");
        assert!(p.is_file(), "missing {}", p.display());
        assert!(std::fs::metadata(&p).unwrap().len() > 1000);
    }

    #[test]
    fn compose_ui_patkit_from_library_dump() {
        let src = home::home_dir()
            .unwrap()
            .join("Library/Application Support/rytm-builder/library/Untitled-1.syx");
        if !src.is_file() {
            eprintln!("skip compose_ui: Untitled-1.syx not in library");
            return;
        }
        let tmp = std::env::temp_dir().join(format!(
            "rytm-builder-compose-ui-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(tmp.join("library")).unwrap();
        std::fs::create_dir_all(tmp.join("exports")).unwrap();
        std::fs::copy(&src, tmp.join("library/Untitled-1.syx")).unwrap();
        let prev_home = std::env::var_os("RYTM_APP_HOME");
        let prev_dl = std::env::var_os("RYTM_DOWNLOADS");
        unsafe {
            std::env::set_var("RYTM_APP_HOME", &tmp);
            std::env::set_var("RYTM_DOWNLOADS", tmp.join("Downloads"));
        }
        let result = compose_ui(UiComposeRequest {
            template: Some(TemplateKind::Baked),
            name: "Fresh_app_wrap_test".into(),
            mode: Some("project".into()),
            copies: Some(vec![UiCopy {
                path: "Untitled-1.syx".into(),
                pattern: Some("A03".into()),
                kit: None,
                dest: "A01".into(),
            }]),
            vacates: None,
            kit_copies: None,
            kit_vacates: None,
            pattern_copies: None,
        });
        match prev_home {
            Some(v) => unsafe { std::env::set_var("RYTM_APP_HOME", v) },
            None => unsafe { std::env::remove_var("RYTM_APP_HOME") },
        }
        match prev_dl {
            Some(v) => unsafe { std::env::set_var("RYTM_DOWNLOADS", v) },
            None => unsafe { std::env::remove_var("RYTM_DOWNLOADS") },
        }
        let result = result.expect("compose_ui");
        assert_eq!(result.out, "Fresh_app_wrap_test.syx");
        assert_eq!(result.mode, "project");
        let bytes = std::fs::read(tmp.join("exports").join(&result.out)).unwrap();
        let check = crate::project::inspect_export(&bytes).unwrap();
        assert!(check.settings_first);
        assert_eq!(check.messages, 405);
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
