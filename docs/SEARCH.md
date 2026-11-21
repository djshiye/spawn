# What the search box can do

Everything on this page works offline. Nothing you type leaves the computer, nothing is looked up on the internet,
and no extra programs are started. Press Return or click a result to copy it (or, for a switch, to flip it).

Each group has its own switch under **Settings > Menu > Search sources**.

## Calculator (`search-calculator`, on)

| Type | Get |
|---|---|
| `2+2`, `(3.5*4)/2`, `2^10`, `7 % 4` | arithmetic with brackets, powers and remainders |
| `15% of 80`, `200 + 10%`, `20% off 80` | percentages |
| `sqrt(16)`, `√16`, `cbrt 27`, `root(27, 3)`, `5²` | roots and powers |
| `sin(30°)`, `cos(pi/3)`, `atan2(1, 1)`, `deg(pi)` | trigonometry (radians, or degrees with `°` / `deg`) |
| `ln(e^2)`, `log(1000)`, `log(8, 2)`, `log2 1024`, `exp(1)` | logarithms |
| `5!`, `ncr(52, 5)`, `npr(5, 2)`, `gcd(12, 18)`, `lcm(4, 6)` | factorials and combinations |
| `min(3, 1, 2)`, `max(...)`, `sum(...)`, `avg(...)`, `hypot(3, 4)`, `round(3.14159, 2)` | several values |
| `0xFF + 1`, `0b1010 * 2`, `1 << 10`, `6 & 3`, `5 xor 1` | hex, binary and octal numbers, bit operations |
| `2pi`, `2(3+4)`, `3 sqrt(4)` | multiplication without the sign |
| `what is 15% of 80?`, `10 mod 3`, `2 to the power of 10`, `3 squared` | plain words |

Constants: `pi` (π), `e`, `tau` (τ), `phi` (φ). The decimal point is `.`; a comma separates function arguments. Long
answers are shown with spaces between the thousands; the copied number never has them.

## Unit conversion (`search-unit-conversion`, on)

Type `<amount> <unit> in <unit>` (also `to`, `as`, `=`, `->`): `5 km in miles`, `100 f in c`, `30 mpg in l/100km`.

| Kind | Units |
|---|---|
| Length | nm, µm, mm, cm, dm, m, km, thou, in, ft, yd, mi, nautical mile, furlong, fathom, chain, au, light year, parsec |
| Area | mm², cm², m², km², hectare, in², ft², yd², mi², acre (`m2`, `sq ft`, `square metres`) |
| Volume | ml, cl, dl, l, hl, m³, cm³ (cc), mm³, in³, ft³, yd³, tsp, tbsp, fl oz, cup, pint, quart, gallon (US), `uk` / `imp` pint, quart, gallon and fl oz, barrel |
| Mass | µg, mg, g, kg, tonne, oz, lb, stone, carat, grain, short ton (`us ton`), long ton (`uk ton`) |
| Temperature | °C, °F, K, °R |
| Speed | m/s, km/h, mph, knot, ft/s, mach |
| Time | ns, µs, ms, s, min, h, day, week, fortnight, month (average), year, decade, century, millennium |
| Data | bit, B, kB to EB (1 GB = 1000 MB), KiB to EiB (1 GiB = 1024 MiB), kbit, Mbit, Gbit |
| Data rate | bit/s, kbit/s, Mbit/s, Gbit/s (`mbps`), B/s, kB/s, MB/s, GB/s (`mb/s`), KiB/s, MiB/s, GiB/s |
| Pressure | Pa, hPa, kPa, MPa, bar, mbar, psi, atm, torr, mmHg, inHg |
| Energy | J, kJ, MJ, cal, kcal, Wh, kWh, MWh, BTU, eV, ft·lbf |
| Power | W, kW, MW, GW, hp, PS, BTU/h |
| Force and torque | N, kN, lbf, kgf, dyn; N·m (`newton metres`), lbf·ft (`lb ft`), kgf·m |
| Angle | degree, radian, grad, turn, arcmin, arcsec |
| Frequency | Hz, kHz, MHz, GHz, THz, rpm |
| Fuel economy | mpg (US), mpg uk, km/l, l/100km |

Also: mixed amounts (`5 ft 10 in in cm`, `1 h 30 min in s`), a sum as the amount (`2*3 km in m`), no amount
(`km in miles`) and `how many feet in a mile`. Some answers add a friendlier split: `180 cm in ft` also says
"5 ft 10.9 in". Plain `ton` is not accepted because it means different weights in different countries. Currencies are
not offered: exchange rates need the internet.

## Smart answers (`search-smart-answers`, on)

| Type | Get |
|---|---|
| `192.168.1.130/26`, `10.0.0.5 255.255.255.0` | network, usable host range, subnet mask, broadcast, host count, wildcard mask |
| `/26`, `255.255.240.0` | the mask for a prefix, or the prefix for a mask |
| `192.168.1.0/24 into /26` | the subnets |
| `10.1.2.3 in 10.0.0.0/8` | whether the address is inside the network |
| `192.168.1.10`, `fe80::1` | what kind of address it is (private, public, link-local...), as a number, in hex and binary, reverse DNS name |
| `2001:db8::/48` | IPv6 network, first and last address, size, expanded form |
| `aa:bb:cc:dd:ee:ff` | the MAC address in the other common spellings, and its type |
| `0xFF`, `0b1010`, `255 in hex`, `255 in binary`, `255 in base 36`, `ascii A` | number bases |
| `#3584e4`, `rgb(53, 132, 228)`, `hsl(213, 76%, 55%)`, `colour rebeccapurple` | the colour as hex, RGB and HSL, with a sample of it |
| `time in tokyo`, `tokyo time`, `now in nyc` | the time there, the date and how far ahead or behind it is |
| `3pm london in tokyo`, `15:30 utc to sarajevo`, `3pm in tokyo`, `9am pst in cet` | a time converted between places |
| `days until 25 dec`, `days since 1 jan 2020`, `days between 1 mar and 25 dec` | counting days |
| `today + 90 days`, `25 dec 2026 - 3 weeks`, `3 weeks ago`, `in 10 days` | date arithmetic |
| `25/12/2027`, `next friday`, `easter 2027`, `what day is 1 jan 2030` | the weekday and how far away it is |
| `week number`, `week of 25 dec`, `day of year` | week and day numbers |
| `unix time`, `unix 1700000000`, `25 dec 2026 to unix` | Unix timestamps |

Places are cities, single-time-zone countries, zone names (`europe/sarajevo`), abbreviations (`utc`, `cet`, `est`,
`pst`, `ist`...) and offsets (`utc+5:30`); the clock follows your 12 or 24 hour setting. Numeric dates are day first
(`25/12/2026`).

## Quick tools (`search-quick-tools`, on)

| Type | Get |
|---|---|
| `password`, `password 24`, `password 16 simple` | a random password (8 to 128 characters; `simple` is letters and digits only) |
| `pin 6`, `uuid` | a random PIN, a random UUID |
| `sha256 text`, `sha1 text`, `md5 text`, `sha512 text`, `hash text` | the hash of the text |
| `base64 text`, `base64 decode ...`, `url encode ...`, `url decode ...` | encoding and decoding |
| `random 1-100`, `roll 2d6`, `flip a coin` | chance |
| `uppercase text`, `lowercase text`, `title case text`, `count text` | text helpers |
| `my ip`, `mac address`, `gateway`, `dns`, `hostname` | this computer's own addresses, as NetworkManager knows them |
| `emoji smile`, `emoji flag bosnia`, `char arrow right`, `symbol pi`, `U+20AC` | an emoji or a special character to copy |

Passwords, PINs, UUIDs and random numbers come from the kernel's random generator. `my ip` shows local addresses
only: the address the internet sees needs an internet lookup, so it is not offered. A tool whose trigger is an
ordinary word does not push apps aside: `password` still finds an app called Passwords first.

## Quick settings (`search-quick-toggles`, on)

Type `dark mode`, `night light`, `do not disturb` (or `dnd`), `wifi`, `bluetooth` or `aeroplane mode`. The row says
what Return will do ("Turn on dark mode"). Add the state to be exact: `wifi off`, `turn on bluetooth`,
`disable night light`. A switch your computer does not have (no Wi-Fi adapter, for example) is not offered.

## Other sources

Apps (always), Settings panels (`display`, `wi-fi`), app actions (`firefox private`), power actions (`lock`,
`restart`; off by default), open windows, recent files and GNOME Shell search providers (off by default). See
[SETTINGS.md](SETTINGS.md) for the keys.
