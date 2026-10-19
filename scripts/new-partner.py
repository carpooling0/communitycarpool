#!/usr/bin/env python3
"""
new-partner.py: onboard a new partner organisation in one step.

  1. creates the organisation (+ campus location) in the database
  2. records the campaign link in referral_links (Campaign Links panel)
  3. makes the branded QR code (PNG + SVG)
  4. writes the email text, copies it to the clipboard

Safe by default: without --apply nothing is written to the database. Dev is the
default environment. Prod needs --env prod --apply --confirm-prod.

Example (dry run, then the real thing on dev):

  python3 scripts/new-partner.py --name "Jebel Ali School" --code jebel_ali_school \\
      --location "Jebel Ali School|25.0237,55.1259" --logo-file ~/Downloads/jas.png
  ... same command plus --apply

Output goes to partner-kits/<code>/ (git-ignored): qr.png, qr.svg, email.txt.
Needs: pip install qrcode pillow numpy zxing-cpp. Database access uses the
Supabase token in ~/.supabase/carpool-token (override with CARPOOL_SUPABASE_TOKEN;
SUPABASE_ACCESS_TOKEN is ignored on purpose, it often belongs to another account).
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import qr_style  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENVS = {
    "dev": {"ref": "jboohdwihsiuvyrfeftp", "site": "https://dev.communitycarpool.org"},
    "prod": {"ref": "tbkjealpnoriwdosvmju", "site": "https://communitycarpool.org"},
}

EMAIL = """Subject: Community Carpool for {name}

{greeting}I hope you are all doing well.

Thank you for taking the time to meet with me{met}. I enjoyed speaking with all of you and discussing how CommunityCarpool could potentially be implemented within {name}.

As discussed, I have attached the presentation PDF and a custom QR code for {name}.

The dedicated link for {name} is:
{link}

Please let me know if you need any additional information or if there is anything else I can provide to support the next steps.

Thank you.

Regards,
{sender}
"""


def sql_str(v):
    return "null" if v is None else "'" + str(v).replace("'", "''") + "'"


def run_sql(env, query):
    # Deliberately not SUPABASE_ACCESS_TOKEN: that variable often holds another Supabase account's token
    token = os.environ.get("CARPOOL_SUPABASE_TOKEN") or open(os.path.expanduser("~/.supabase/carpool-token")).read().strip()
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ENVS[env]['ref']}/database/query",
        data=json.dumps({"query": query}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                 "User-Agent": "new-partner-script"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"Database error ({e.code}): {e.read().decode()[:500]}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--name", required=True, help='Official name, e.g. "Jebel Ali School"')
    ap.add_argument("--code", required=True, help="Short link code, lowercase letters, digits, underscore (the ?client= value)")
    ap.add_argument("--location", action="append", default=[], metavar="NAME|LAT,LNG",
                    help="Destination shown on the form (repeatable), e.g. 'Jebel Ali School|25.0237,55.1259'")
    ap.add_argument("--logo-file", help="Local logo file, copied to orgs/<code>.<ext> (goes live on next frontend deploy)")
    ap.add_argument("--logo-url", help="Existing hosted logo URL instead of a file")
    ap.add_argument("--message", help='Line shown under the logo (default "Carpool platform for <name>")')
    ap.add_argument("--cross-matching", action="store_true", help="Allow matching with people outside this organisation")
    ap.add_argument("--env", choices=ENVS, default="dev")
    ap.add_argument("--apply", action="store_true", help="Actually write to the database (default is a dry run)")
    ap.add_argument("--confirm-prod", action="store_true", help="Required together with --apply for --env prod")
    ap.add_argument("--kit-only", action="store_true",
                    help="Organisation already exists: skip creating it, just rebuild the QR code and email in partner-kits/")
    ap.add_argument("--sender", default="Anvith")
    ap.add_argument("--greeting", default="", help='Optional opening line, e.g. "Dear Sarah,"')
    ap.add_argument("--met", default="", help='When you met, e.g. "on Monday"; leave out if unsure')
    a = ap.parse_args()

    code = a.code.strip().lower()
    if not re.fullmatch(r"[a-z0-9_]{2,40}", code):
        sys.exit("--code must be 2 to 40 characters: lowercase letters, digits and underscore only")
    if a.logo_file and a.logo_url:
        sys.exit("Use either --logo-file or --logo-url, not both")
    if a.env == "prod" and a.apply and not a.confirm_prod:
        sys.exit("Prod write refused: add --confirm-prod to confirm you mean the live database")

    env = ENVS[a.env]
    link = f"{env['site']}/?client={code}"
    locations = []
    for loc in a.location:
        try:
            nm, ll = loc.rsplit("|", 1)
            lat, lng = [float(x) for x in ll.split(",")]
            assert -90 <= lat <= 90 and -180 <= lng <= 180
        except Exception:
            sys.exit(f"Bad --location {loc!r}: expected 'Name|lat,lng'")
        locations.append((nm.strip(), f"{lat}, {lng}"))

    logo_url = a.logo_url
    logo_dest = None
    if a.logo_file:
        src = os.path.expanduser(a.logo_file)
        if not os.path.isfile(src):
            sys.exit(f"Logo file not found: {src}")
        ext = os.path.splitext(src)[1].lower() or ".png"
        logo_dest = os.path.join(ROOT, "orgs", code + ext)
        logo_url = f"{env['site']}/orgs/{code}{ext}"
    message = a.message or f"Carpool platform for {a.name}"

    # Pre-flight: refuse duplicates, warn on look-alikes
    first_word = a.name.split()[0]
    existing = run_sql(a.env, f"select org_id, org_code, org_name from organisations "
                              f"where org_code = {sql_str(code)} or org_name ilike {sql_str('%' + first_word + '%')} order by org_id")
    clash = [r for r in existing if r["org_code"] == code]
    if clash and not a.kit_only:
        sys.exit(f"Code {code!r} already exists on {a.env} ({clash[0]['org_name']}). Nothing changed.")
    if a.kit_only and not clash:
        sys.exit(f"--kit-only needs an existing organisation, but code {code!r} was not found on {a.env}.")

    print(f"\nEnvironment : {a.env}  ({'kit only, no database write' if a.kit_only else 'WILL WRITE' if a.apply else 'dry run, nothing written'})")
    print(f"Organisation: {a.name}  [code: {code}]")
    print(f"Link        : {link}")
    print(f"Logo        : {logo_url or '(none)'}" + (f"   <- copies {a.logo_file}" if logo_dest else ""))
    print(f"Message     : {message}")
    print(f"Cross-match : {a.cross_matching}")
    if locations:
        for nm, ll in locations:
            print(f"Location    : {nm}  ({ll})")
    else:
        print("Location    : (none: the form will show a free-text destination)")
    others = [r for r in existing if r["org_code"] != code]
    if others:
        print("\nLook-alike organisations already on " + a.env + " (check this is not a duplicate):")
        for r in others:
            print(f"   #{r['org_id']}  {r['org_code']}  {r['org_name']}")

    if not a.apply and not a.kit_only:
        print("\nDry run only. Re-run with --apply to create everything.")
        return

    if not a.kit_only:
        # 1 + 2: organisation, locations, campaign link, one statement so it is all or nothing
        loc_cte = ""
        if locations:
            vals = ", ".join(f"({sql_str(n)}, {sql_str(l)})" for n, l in locations)
            loc_cte = (f", l as (insert into org_locations (org_id, location_name, location_latlng, is_active) "
                       f"select o.org_id, v.n, v.ll, true from o, (values {vals}) as v(n, ll) returning location_id)")
        query = (
            f"with o as (insert into organisations (org_code, org_name, logo_url, custom_message, allow_cross_matching, is_active) "
            f"values ({sql_str(code)}, {sql_str(a.name)}, {sql_str(logo_url)}, {sql_str(message)}, {str(a.cross_matching).lower()}, true) "
            f"returning org_id)" + loc_cte +
            f", r as (insert into referral_links (mode, url, person_campaign_name, created_by_name) "
            f"values ('client', {sql_str(link)}, {sql_str(a.name)}, 'new-partner script') on conflict do nothing returning id) "
            f"select (select org_id from o) as org_id, (select count(*) from r) as link_rows"
        )
        res = run_sql(a.env, query)
        print(f"\nCreated organisation #{res[0]['org_id']} on {a.env}"
              + ("" if res[0]["link_rows"] else " (campaign link was already recorded)"))

        # Logo copy (after the DB write succeeded); skip if the file is already in orgs/
        if logo_dest:
            os.makedirs(os.path.dirname(logo_dest), exist_ok=True)
            if not (os.path.exists(logo_dest) and os.path.samefile(os.path.expanduser(a.logo_file), logo_dest)):
                shutil.copyfile(os.path.expanduser(a.logo_file), logo_dest)
            print(f"Logo saved to {os.path.relpath(logo_dest, ROOT)}  (shows on the form after the next frontend deploy)")

    # Verify the live lookup the form uses
    chk = run_sql(a.env, f"select o.org_name, o.is_active, (select count(*) from org_locations l where l.org_id=o.org_id and l.is_active) as locs "
                         f"from organisations o where o.org_code = {sql_str(code)}")
    print(f"Check       : {chk[0]['org_name']} active={chk[0]['is_active']} locations={chk[0]['locs']}")

    # 3: QR code
    kit = os.path.join(ROOT, "partner-kits", code)
    os.makedirs(kit, exist_ok=True)
    png, svg = qr_style.render(link, os.path.join(kit, "qr"))
    ok, got = qr_style.verify(png, link)
    print(f"QR code     : {os.path.relpath(png, ROOT)} (+ .svg), scan check {'OK' if ok else 'FAILED, read ' + repr(got)}")
    if not ok:
        print("WARNING: the QR code did not scan back to the link. Do not send it; make this one in QR Code Monkey.")

    # 4: email
    text = EMAIL.format(name=a.name, link=link, sender=a.sender,
                        greeting=(a.greeting + "\n\n") if a.greeting else "",
                        met=(" " + a.met) if a.met else "")
    with open(os.path.join(kit, "email.txt"), "w") as f:
        f.write(text)
    try:
        subprocess.run(["pbcopy"], input=text.encode(), check=True)
        copied = " (copied to clipboard)"
    except Exception:
        copied = ""
    print(f"Email text  : {os.path.relpath(os.path.join(kit, 'email.txt'), ROOT)}{copied}\n")
    print("-" * 60)
    print(text)
    print("-" * 60)
    if a.env == "dev":
        print("NOTE: this ran on DEV, so the link above points at dev.communitycarpool.org. "
              "Re-run with --env prod --apply --confirm-prod when you want the real one.")
    elif logo_dest:
        print("REMINDER: the logo only shows once you run deploy-prod.sh (the file is in orgs/).")


if __name__ == "__main__":
    main()
