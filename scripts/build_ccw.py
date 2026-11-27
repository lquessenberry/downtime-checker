#!/usr/bin/env python3
"""Build globalstatus/api/ccw-reciprocity.json (USA CONCEALED CARRY RECIPROCITY).

Compiled by hand from public government sources, last verified Nov 2026. Each state's
'honors' rule says which other states' permits it recognizes for visitors. The browser
(ccw.js) works out the relationship for a chosen permit state. No text is copied from
commercial reciprocity sites.

Sources read (official pages unless noted):
  CO  Colorado Bureau of Investigation, CHP Reciprocity; C.R.S. 18-12-213
  DE  Delaware DOJ, Concealed Carry Deadly Weapons (list for Jan 15 2025 - Jan 15 2026, no removal notices posted)
  IL  430 ILCS 66/40(e); Illinois State Police firearms transportation guide
  MI  Michigan State Police, Reciprocity; MCL 28.432a
  MN  Minnesota DPS / BCA, Permit to Carry reciprocity
  NV  Nevada DPS Records, Communications and Compliance Division, Out-of-State CCW (NRS 202.3689)
  NM  New Mexico DPS, Concealed Carry Licenses, Recognition and Reciprocity table
  NC  N.C. DOJ, Concealed Handguns Reciprocity; G.S. 14-415.24
  ND  North Dakota Attorney General, Reciprocity with Other States; Constitutional Concealed Carry
  PA  Pennsylvania Office of Attorney General, Concealed Carry Reciprocity
  VA  Virginia State Police, Reciprocity and Recognition; Va. Code 18.2-308.014
  WA  Washington Attorney General, Concealed Pistol License Reciprocity (updated 07/10/2026)
  WI  Wisconsin DOJ, CCW Reciprocity
  CA CT DC HI MD MA NJ NY OR RI: Washington AG table ("Does not recognize out-of-state licenses"),
      Colorado CBI and Pennsylvania OAG tables
  FL  Fla. Stat. 790.01, 790.015; FDACS Concealed Weapon License Reciprocity (Eubanks ruling note)
  Permitless list and ages: state statutes as summarized by USCCA (10/16/2026); N.C. General Assembly SB 50 page
  Duty to inform: statutes as quoted in the handgunlaw.us "Must Inform" compilation (links checked 9/5/2026):
      AS 11.61.220, 5 CAR 1-201, D.C. Code 7-2509.04, HRS 134-9.2, La. R.S. 40:1379.3, 25 M.R.S. 2003-A,
      Tex. Gov't Code 411.205, Ohio SB 215 (2022), S.C. H. 3594 (2024); 21 O.S. 1290.8 (Oklahoma);
      North Dakota AG Constitutional Concealed Carry page
"""
import json

NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts",
    "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
    "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
BY_NAME = {v: k for k, v in NAMES.items()}


def codes(text):
    return [BY_NAME[n.strip()] for n in text.split(",") if n.strip()]


# Permitless (constitutional) carry: minimum age and who it covers. 29 states.
PERMITLESS = {
    "AL": "Adults 19 and older who may legally have a handgun.",
    "AK": "Adults 21 and older who may legally have a handgun.",
    "AZ": "Adults 21 and older who may legally have a handgun.",
    "AR": "Adults 19 and older who may legally have a handgun.",
    "FL": "Visitors 21 and older (18 for service members and honorably discharged veterans) who meet Florida's license criteria, or who carry a resident license from their home state. Florida residents 18 and older after a June 2026 appeals court ruling.",
    "GA": "Adults 21 and older (18 for military) who may legally have a handgun.",
    "ID": "U.S. citizens and current military members 18 and older who may legally have a handgun.",
    "IN": "Adults 18 and older who may legally have a handgun.",
    "IA": "Adults 18 and older who may legally have a handgun.",
    "KS": "Adults 21 and older who may legally have a handgun.",
    "KY": "Adults 21 and older who may legally have a handgun.",
    "LA": "Adults 18 and older who may legally have a handgun.",
    "ME": "Adults 21 and older (18 for active-duty and honorably discharged military) who may legally have a handgun.",
    "MS": "Adults 18 and older who may legally have a handgun.",
    "MO": "Adults 19 and older (18 for military) who may legally have a handgun.",
    "MT": "Adults 18 and older who may legally have a handgun.",
    "NE": "Adults 21 and older (18 for military) who may legally have a handgun.",
    "NH": "Adults 18 and older who may legally have a handgun.",
    "ND": "North Dakota residents 18 and older only. Visitors need a permit North Dakota honors.",
    "OH": "Adults 21 and older (18 for military) who may legally have a handgun.",
    "OK": "Adults 21 and older (18 for military) who may legally have a handgun.",
    "SC": "Adults 18 and older who may legally have a handgun.",
    "SD": "Adults 18 and older who may legally have a handgun.",
    "TN": "Adults 21 and older (18 for military) who may legally have a handgun.",
    "TX": "Adults 21 and older who may legally have a handgun.",
    "UT": "Adults 21 and older who may legally have a handgun.",
    "VT": "Adults 18 and older who may legally have a handgun. Vermont issues no carry permits.",
    "WV": "Adults 18 and older who may legally have a handgun.",
    "WY": "Adults 18 and older who may legally have a handgun.",
}
RESIDENTS_ONLY = {"ND"}

INFORM_YES = {
    "AK": "Yes. Tell the officer right away that you are carrying, on any official contact.",
    "AR": "Yes. When an officer asks for identification, show your license and say you have a handgun.",
    "DC": "Yes. On any stop, say you are carrying, show your license and registration, and say where the pistol is.",
    "HI": "Yes. Tell the officer right away that you are carrying when you are stopped, including in a vehicle.",
    "LA": "Yes. Tell any officer who approaches you officially that you are carrying.",
    "ME": "Yes if you carry without a permit: tell the officer right away on any stop or detention.",
    "MI": "Yes. Tell the officer right away that you are carrying when you are stopped.",
    "NE": "Yes. Tell police or emergency services right away that you are carrying.",
    "NJ": "Yes. Tell the officer right away that you are carrying when you are stopped.",
    "NC": "Yes. Tell the officer right away that you are carrying when approached or addressed.",
    "ND": "Yes if you carry without a permit: tell any officer who contacts you in person.",
    "TX": "Yes when asked for ID: show your license to carry along with your ID.",
    "CA": "Not by state law, but many local permits require it as a permit condition.",
    "OH": "Only when an officer asks.",
    "OK": "Only when an officer asks during an arrest, detention or traffic stop.",
    "SC": "Only when an officer asks.",
}
INFORM_DEFAULT = "No duty to volunteer it, but show your permit and ID if an officer asks."

PLACES_DEFAULT = ("Commonly off-limits: schools, courthouses, police stations and jails, airport secure areas, "
                  "federal buildings, and private property where the owner bans guns. Many states add bars, "
                  "polling places, sports venues and government meetings.")
PLACES_EXTRA = {
    "CA": "California added a long list of sensitive places in 2024, including parks, public transit, bars, hospitals and many public gatherings.",
    "NY": "New York lists many sensitive places, including Times Square, public transit, parks, bars, theaters and houses of worship.",
    "NJ": "New Jersey lists many sensitive places, including parks, beaches, public transit, bars, theaters and health care facilities.",
    "MD": "Maryland lists many sensitive places, including museums, stadiums, health care facilities, public transit and bars.",
    "HI": "Hawaii lists many sensitive places, including beaches, parks, bars, banks and public transit.",
    "MA": "Massachusetts bans carry in many government buildings, schools, polling places and some public gatherings.",
    "IL": "Illinois bans carry on public transit, in parks, bars, hospitals, stadiums, libraries and many other places.",
    "DC": "D.C. bans carry on public transit, near the White House and Capitol, in parks, bars and many other places.",
    "TX": "Texas businesses can ban carry with posted signs, and carry is banned where alcohol is 51% of sales.",
}

# Who each state honors (visitors).
HONORS = {
    # States that recognize no out-of-state permits.
    **{k: {"type": "none"} for k in ["CA", "CT", "DC", "HI", "MD", "MA", "NJ", "NY", "OR", "RI"]},
    "IL": {"type": "vehicle", "note": "Illinois honors no out-of-state permits. A visitor who may legally carry at home can keep a loaded handgun concealed in their own vehicle only, and locked in the vehicle if they leave it."},
    "MI": {"type": "all", "resident": True, "note": "Michigan recognizes a concealed pistol license issued by the holder's state of residence."},
    "NC": {"type": "all", "note": "North Carolina recognizes valid concealed handgun permits issued by every other state."},
    "VA": {"type": "all", "age21": True, "note": "Virginia recognizes permits from every state for holders 21 and older who carry government photo ID (current law through June 30, 2027)."},
    "CO": {"type": "list", "resident": True, "age21": True,
           "list": codes("Alabama, Alaska, Arizona, Arkansas, Delaware, Florida, Georgia, Idaho, Iowa, Indiana, Kansas, Kentucky, Louisiana, Michigan, Minnesota, Mississippi, Missouri, Montana, Nebraska, New Hampshire, New Mexico, North Carolina, North Dakota, Ohio, Oklahoma, Pennsylvania, South Dakota, Tennessee, Texas, Utah, Virginia, West Virginia, Wisconsin, Wyoming"),
           "note": "Colorado honors permits only from states that honor Colorado's, only for residents of the issuing state (with a matching state ID), age 21 and older."},
    "DE": {"type": "list",
           "list": codes("Alaska, Arizona, Arkansas, Colorado, Florida, Idaho, Kansas, Kentucky, Maine, Michigan, Missouri, New Mexico, North Carolina, North Dakota, Ohio, Oklahoma, South Dakota, Tennessee, Texas, Utah, West Virginia"),
           "cls": {"ID": "Idaho enhanced permits only", "ND": "North Dakota Class 1 permits only", "SD": "South Dakota enhanced permits only"},
           "note": "Delaware honors resident and nonresident permits from the listed states."},
    "MN": {"type": "list",
           "list": codes("Alaska, Arkansas, California, Colorado, Connecticut, Delaware, Hawaii, Idaho, Illinois, Kansas, Kentucky, Louisiana, Maryland, Massachusetts, Michigan, Mississippi, Missouri, Montana, Nebraska, Nevada, New Jersey, New Mexico, New York, North Carolina, North Dakota, Ohio, Oklahoma, Rhode Island, South Carolina, South Dakota, Tennessee, Texas, West Virginia"),
           "cls": {"CO": "Colorado permits issued or renewed on or after Aug 1, 2024 only", "MA": "Massachusetts permits issued or renewed on or after Aug 1, 2024 only",
                   "ID": "Idaho enhanced permits only", "MS": "Mississippi enhanced permits only", "MT": "Montana enhanced permits only",
                   "ND": "North Dakota Class 1 permits only", "SD": "South Dakota enhanced permits only", "TN": "Tennessee enhanced permits only"},
           "note": "Minnesota honors permits from states whose laws it finds similar to its own."},
    "NV": {"type": "list",
           "list": codes("Alaska, Arizona, Arkansas, Florida, Idaho, Illinois, Kansas, Kentucky, Louisiana, Massachusetts, Minnesota, Mississippi, Montana, Nebraska, New Mexico, North Carolina, North Dakota, Ohio, Oklahoma, South Carolina, South Dakota, Tennessee, Texas, Utah, Virginia, West Virginia, Wisconsin, Wyoming"),
           "cls": {"ID": "Idaho enhanced permits only", "MS": "Mississippi enhanced permits only", "ND": "North Dakota Class 1 permits only", "SD": "South Dakota enhanced permits only"},
           "note": "Nevada honors permits from the states on its Department of Public Safety list."},
    "NM": {"type": "list",
           "list": codes("Arizona, Arkansas, Colorado, Delaware, Florida, Kansas, Michigan, Mississippi, Missouri, Nebraska, Nevada, North Carolina, North Dakota, Ohio, Oklahoma, South Carolina, South Dakota, Texas, Virginia, Wyoming"),
           "note": "New Mexico honors licenses from the states on its Department of Public Safety reciprocity table, for visitors who are not New Mexico residents."},
    "PA": {"type": "list", "resident": True, "age21": True,
           "list": codes("Alabama, Alaska, Arkansas, Colorado, Florida, Georgia, Idaho, Indiana, Iowa, Kansas, Kentucky, Louisiana, Michigan, Mississippi, Missouri, Montana, New Hampshire, North Carolina, North Dakota, Ohio, Oklahoma, South Dakota, Tennessee, Texas, Utah, Virginia, West Virginia, Wisconsin, Wyoming"),
           "cls": {"ID": "Idaho enhanced permits only", "ND": "North Dakota Class 1 permits only", "UT": "Utah regular permits only (not provisional)"},
           "note": "Pennsylvania honors permits from these states only for residents of the issuing state, age 21 and older."},
    "WA": {"type": "list", "age21": True,
           "list": codes("Idaho, Kansas, Louisiana, Michigan, Montana, North Carolina, North Dakota, Ohio, South Dakota, Utah"),
           "cls": {"ID": "Idaho enhanced permits only", "KS": "Kansas standard licenses only", "MT": "Montana enhanced permits only (not the restricted permit for ages 18 to 20)",
                   "ND": "North Dakota Class 1 permits only", "SD": "South Dakota unrestricted enhanced and gold permits only", "UT": "Utah regular permits only (not provisional)"},
           "note": "Washington honors permits only from states that honor Washington's, issue only to people 21 and older, and require fingerprint and mental health background checks."},
    "WI": {"type": "list", "age21": True,
           "list": codes("Alabama, Alaska, Arizona, Arkansas, California, Colorado, Connecticut, Delaware, District of Columbia, Florida, Georgia, Hawaii, Idaho, Illinois, Indiana, Iowa, Kansas, Kentucky, Louisiana, Maryland, Massachusetts, Michigan, Minnesota, Mississippi, Missouri, Montana, Nebraska, New Hampshire, Nevada, New Mexico, New York, North Carolina, North Dakota, Ohio, Oklahoma, Pennsylvania, Rhode Island, South Carolina, South Dakota, Tennessee, Texas, Utah, Virginia, Washington, West Virginia, Wyoming"),
           "cls": {"FL": "Florida NONRESIDENT licenses only; a Florida resident license is not honored", "VA": "Virginia NONRESIDENT licenses only; a Virginia resident license is not honored",
                   "ID": "Idaho regular or enhanced licenses (not emergency)", "MO": "Missouri regular licenses (not provisional)", "WV": "West Virginia regular licenses (not provisional)"},
           "note": "Wisconsin honors permits from the states on its Department of Justice list for visitors 21 and older who are not Wisconsin residents."},
    # North Dakota: permitless for its own residents only; visitors need a permit it honors.
    "ND": {"type": "list",
           "list": codes("Alabama, Alaska, Arizona, Arkansas, Colorado, Delaware, Florida, Georgia, Idaho, Indiana, Iowa, Kansas, Kentucky, Louisiana, Maine, Michigan, Minnesota, Mississippi, Missouri, Montana, Nebraska, Nevada, New Hampshire, New Mexico, North Carolina, Ohio, Oklahoma, Pennsylvania, South Carolina, South Dakota, Tennessee, Texas, Utah, Vermont, Virginia, Washington, West Virginia, Wisconsin, Wyoming"),
           "note": "North Dakota honors resident and nonresident permits from states that honor North Dakota's."},
}
# Permitless states: anyone eligible may carry, so their honor lists matter only for places
# where a permit gives extra rights; they are shown as permitless carry for visitors.
for k in PERMITLESS:
    HONORS.setdefault(k, {"type": "permitless"})

# Wisconsin's list includes Vermont only by name; Vermont issues no permits.
NO_PERMITS = {"VT"}


def main():
    states = {}
    for code, name in NAMES.items():
        pc = code in PERMITLESS
        states[code] = {
            "name": name,
            "permitless": pc,
            "permitlessResidentsOnly": code in RESIDENTS_ONLY,
            "permitlessRule": PERMITLESS.get(code, "No. A permit is required to carry a concealed handgun."),
            "minAge": PERMITLESS[code].split(".")[0] if pc else "A permit is required; most states issue permits at 21.",
            "inform": INFORM_YES.get(code, INFORM_DEFAULT),
            "places": (PLACES_EXTRA[code] + " " if code in PLACES_EXTRA else "") + PLACES_DEFAULT,
            "honors": HONORS[code],
            "noPermits": code in NO_PERMITS,
        }
    assert len(states) == 51 and sum(1 for s in states.values() if s["permitless"]) == 29
    doc = {
        "title": "USA CONCEALED CARRY RECIPROCITY",
        "verified": "Nov 2026",
        "source": "State Attorney General & State Police reciprocity lists (public records)",
        "disclaimer": "Not legal advice. Verify with state authorities before traveling.",
        "states": states,
    }
    json.dump(doc, open("globalstatus/api/ccw-reciprocity.json", "w"), indent=1, ensure_ascii=False)
    print("states", len(states), "permitless", sum(1 for s in states.values() if s["permitless"]))


if __name__ == "__main__":
    main()
