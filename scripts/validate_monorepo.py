"""Valida la estructura y los registros de Segmenta Studio."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def load(path):
    return json.loads(path.read_text(encoding="utf-8"))

def main():
    errors = []
    workspace = load(ROOT / "workspace.json")
    for folder in workspace["layout"].values():
        if not (ROOT / folder).is_dir():
            errors.append(f"Falta la carpeta: {folder}")
    registry = load(ROOT / workspace["registries"]["skills"])
    seen = set()
    for skill in registry["skills"]:
        skill_id = skill["id"]
        if skill_id in seen:
            errors.append(f"Skill duplicada: {skill_id}")
        seen.add(skill_id)
        directory = ROOT / skill["path"]
        for required in ("SKILL.md", "manifest.json"):
            if not (directory / required).is_file():
                errors.append(f"{skill_id}: falta {required}")
        if (directory / "manifest.json").is_file():
            manifest = load(directory / "manifest.json")
            if manifest.get("id") != skill_id:
                errors.append(f"{skill_id}: id incorrecto")
            if manifest.get("version") != skill.get("version"):
                errors.append(f"{skill_id}: versión incorrecta")
    if errors:
        print("\n".join(f"ERROR: {error}" for error in errors))
        return 1
    print(f"Monorepositorio válido: {len(seen)} skill(s) registradas.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
