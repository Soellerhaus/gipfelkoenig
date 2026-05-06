#!/usr/bin/env python3
"""Pruefe welche Unsplash-Photo-IDs funktionieren (200 OK)."""
import requests
import sys

# Sport/Outdoor IDs (von verschiedenen Unsplash-Suchen)
SPORT_IDS = [
    # alpine-hiker
    "1649124941653-d33d7baad7ac", "1622191712616-2db3b5895e3e",
    "1680715764433-fdb5707635df", "1706811618759-2971389ba999",
    "1697797284177-95eb0799c4ed", "1599725695996-a5ebb7120721",
    "1694933924697-320542bc3a03", "1519575177684-20058cd53bff",
    "1608040313640-f0f106836ae5", "1533540760201-950afeb96411",
    "1691782834318-0dea0ce990d5", "1534321896477-bab66f3dec1c",
    "1533540046196-4710d983af1b", "1573137700231-0f09df5c8cf9",
    "1533540570515-6ffd9bda4b94", "1568638796491-68c454bd60ee",
    "1732540449870-f3e4c4506055", "1759161039021-968808ab6af8",
    "1516573454759-d43e4d43dce9",
    # trail-runner-mountains
    "1560354790-a403c5a97e0f", "1504025468847-0e438279542c",
    "1712955685153-1b9c8edd071f", "1610066370580-f698d2ccfb69",
    "1665502089396-0f5b9864bf1d", "1665502090508-f3c1064a56bc",
    "1560354892-75d8f5d0b5e9", "1665502089573-7983977fabf7",
    "1700667878010-8ddf2ccc60d0", "1667205742805-b5154830522b",
    "1731991027003-386ac5ae9c72", "1665502090549-593cb6b38934",
    # ski-touring-alps
    "1664436341001-b02974ae7524", "1562826542-449090f38c70",
    "1618648324286-5c087d9419b8", "1644869432047-fa8bdbe849cd",
    "1518784095177-ef1da6313126", "1642841220705-b03194dd9de7",
    "1464722557942-f2cf145d3cae", "1548604130-5db6fcf5fc13",
    "1563442162585-fa1426255ea9", "1714072535859-ba718811ef11",
    "1600785524973-e518061204be", "1524992622325-a5b57c403ad3",
    "1580157906144-3fd1489f66e0", "1619732913960-d23a50661692",
    "1731663020994-b3dbcaf14ac7",
]

# Portrait IDs
PORTRAIT_IDS = [
    "1665568216027-485a41276152", "1576581531914-3b397ce1a99a",
    "1717882069011-3c55702c6e92", "1590682015537-ed79bb46cf49",
    "1737553338682-cd52f5df9781", "1777739890188-4e6c3c417d5e",
    "1708590274972-a7f437c05477", "1636810528913-8a1035067e03",
    "1731248756535-3135d2b7e8ba", "1555557135-0971899f7e3c",
    "1724759968429-326ae674aba7", "1748280155118-fbac24d2ac49",
    "1672653222135-b46f7411bf52",
]


def check(pid):
    try:
        url = f"https://images.unsplash.com/photo-{pid}?w=200&h=200&fit=crop"
        r = requests.head(url, timeout=5, allow_redirects=True)
        return r.status_code == 200
    except Exception:
        return False


def main():
    sport_ok = []
    print(f"Pruefe {len(SPORT_IDS)} Sport-IDs...")
    for i, pid in enumerate(SPORT_IDS):
        if check(pid):
            sport_ok.append(pid)
            sys.stdout.write(".")
        else:
            sys.stdout.write("X")
        sys.stdout.flush()
    print(f"\n  {len(sport_ok)}/{len(SPORT_IDS)} Sport-Fotos OK")

    portrait_ok = []
    print(f"\nPruefe {len(PORTRAIT_IDS)} Portrait-IDs...")
    for pid in PORTRAIT_IDS:
        if check(pid):
            portrait_ok.append(pid)
            sys.stdout.write(".")
        else:
            sys.stdout.write("X")
        sys.stdout.flush()
    print(f"\n  {len(portrait_ok)}/{len(PORTRAIT_IDS)} Portrait-Fotos OK")

    print("\n# Sport-Fotos (verifiziert):")
    for p in sport_ok:
        print(f'    "{p}",')
    print("\n# Portrait-Fotos (verifiziert):")
    for p in portrait_ok:
        print(f'    "{p}",')


if __name__ == "__main__":
    main()
