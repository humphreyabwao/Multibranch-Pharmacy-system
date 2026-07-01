"""
Print the secure setup commands for PharmaFlow Supabase fallback.

The Supabase service role key must never be committed or placed in frontend JS.
Run the printed Firebase secret commands locally, then paste the SQL file into
the Supabase SQL editor.
"""

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SQL_PATH = PROJECT_ROOT / "supabase" / "fallback_schema.sql"


def main():
    print("PharmaFlow Supabase fallback setup")
    print("=" * 40)
    print()
    print("1. In Supabase SQL Editor, run:")
    print(f"   {SQL_PATH}")
    print()
    print("2. Configure Firebase Functions server-side settings:")
    print('   firebase functions:secrets:set SUPABASE_SERVICE_ROLE_KEY')
    print('   powershell -Command "Set-Content -Path functions/.env -Value \'SUPABASE_URL=https://bqqhrpyljlcvxyutxoxv.supabase.co\'"')
    print()
    print("3. Deploy hosting + functions:")
    print("   firebase deploy --only functions,hosting")
    print()
    print("Security note: use the Supabase service_role key only as a Firebase secret.")
    print("Do not paste it into any file under js/ or any hosted frontend asset.")


if __name__ == "__main__":
    main()
