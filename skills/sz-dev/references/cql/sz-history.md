# CQL Module SZ History

One line per SZ touching the CQL module pack scope (`cql/`, `cclib/cqlA`,
`cclib/cql`, `gdbscripts/`), from git history — the prior-art source for
the routing step (see `routing.md` "Mandatory post-routing actions").
First commit date per SZ; type is guessed from the title (trust the
title, not the tag). `*` in the Pack column = worked example already
referenced by this pack (repro.md / automation.md / routing.md); fetch
its FRD/comments from softzilla MCP (`bug_info` / `bug_comments`) when
it matches your SZ family.

Source: `git log -- cql/ cclib/cqlA cclib/cql gdbscripts/` @ branch
ee-branch-ai, last synced 2026-09-23. 460+ SZs total, 2004–2026;
2018+ enumerated below (~195), earlier years counted only — use
`git log --grep=SZxxxxx` for those.

Pack-referenced SZs outside the enumerated range/scope:

| SZ | Date | Type | Title | Note |
| -- | ---- | ---- | ----- | ---- |
| SZ17562 | 2017-09-30 | feat | Outpatient Clinic ADT Lab Find-Patient cql to support Unlinked records | In scope but pre-2018; find-pat Unlinked worked example (routing.md) |
| SZ27614 | 2024-05-08 | bug | get-fluids-by-ien needs to choose the first non-obsolete entry | Landed in `cclib/PharmacyOrder/` (C consumer of the inbound pharmacy pipeline), outside the log paths above; Lib-kind deliverables worked example (automation.md) |

## 2026 (19)

| SZ | Date | Type | Title | Pack |
| -- | ---- | ---- | ----- | ---- |
| SZ35262 | 08-12 | bug | - [CLOUD][AWS] $CCSYSDIR *.nogo safety flags are not host-qualified |  |
| SZ34707 | 06-04 | feat | [LIS] Vitros Order JSON improvements |  |
| SZ34739 | 06-02 | bug | Inbound Rad Reports wrr needs to gracefully deal with a blank patid... | repro * |
| SZ34585 | 05-26 | feat | [LIS] Add required Makefile for config.laborder installation |  |
| SZ34645 | 05-26 | feat | [LIS] Vitros Order JSON should only contain analyte/device code for... |  |
| SZ34644 | 05-24 | feat | [Inbound]Radiology Reports - Update comment in hl7oru_wrr.scm |  |
| SZ34558 | 05-21 | feat | [LIS] Vitros Order Adapter needs to translate Panel LOINCs to indiv... |  |
| SZ34595 | 05-21 | feat | [Inbound]Radiology Reports - use the patid to find the right record... | repro * |
| SZ34604 | 05-21 | feat | [LIS] errobj longtime-to-formatted-string if birthdate is before 1970 | repro * |
| SZ34580 | 05-20 | feat | - [Inbound] Enhancement Request: Support Additional ORU^R01 HL7... |  |
| SZ34272 | 05-11 | feat | [LIS] Vitros Order Adapter to JSON Improvements - translate LOINC t... |  |
| SZ34445 | 05-11 | bug | - RadioView Report CQL crash when MRN not found |  |
| SZ34401 | 05-07 | bug | [Inbound] Radioview Interoperability missing ACK on ORU reception | repro * |
| SZ33851 | 04-30 | feat | [SD413997]Vitros Order Adapter - translate generic HL7 orders into... |  |
| SZ33979 | 04-27 | feat | [Interface] [Inbound] [Outbound] [GoLive] Radiology Radioview  ORU ... |  |
| SZ33349 | 02-14 | feat | [Interface] [Inbound] [Outbound] Radiology Order interface integrat... |  |
| SZ31689 | 02-06 | feat | [SD411445][AWS][Container][podman] migrate $CCSYSDIR subdirectories | auto * |
| SZ31690 | 02-06 | feat | [SD411445][AWS][Container][podman] migrate $CCRUN/$SITE/adminutil |  |
| SZ31716 | 02-06 | feat | [SD411445][AWS][Container][podman] migrate $CCSYSDIR/template subdi... |  |

## 2025 (19)

| SZ | Date | Type | Title | Pack |
| -- | ---- | ---- | ----- | ---- |
| SZ32376 | 11-06 | bug | [WRHH][ptld] Errors in ptld tasklist |  |
| SZ31520 | 08-05 | bug | [WRHH][SD411179] cqllog coredump on WRHH deidentified record |  |
| SZ30797 | 06-12 | feat | Problem found with labs that they are sending with multiple OBX lin... |  |
| SZ30341 | 05-21 | feat | [Inbound][SD409075]Microbiology Note Report for OROH |  |
| SZ30670 | 05-21 | bug | [VAD] Order Name for Cefazolin and Mageisum are missing concentration |  |
| SZ30519 | 05-07 | feat | [Inbound]Configuration for hl7dsstxorders.scm per category type per... |  |
| SZ30455 | 04-29 | feat | [VAD]Expected Drug Name Construction unexpectedly does NOT display ... |  |
| SZ30269 | 04-16 | bug | Duplicate coins in the ccrx database & EPO Order Name on MAR and I&... |  |
| SZ30352 | 04-16 | feat | [Inbound][VAD]INP Fluid Naming for Flowsheet Labels |  |
| SZ30378 | 04-16 | feat | [Inbound][DSS]Add logging of Med COINs to hl7dsspharm.scm |  |
| SZ30349 | 04-12 | bug | [Inbound][DSS][SD409646]hl7dsstxorders.scm mislabels Nursing orders... | repro * |
| SZ30111 | 03-19 | feat | [VAD][GoLive] Make the storing of orders configurable per category... |  |
| SZ30084 | 03-13 | bug | [VAD][GoLive] Norepinephrine Message Processed to Wrong Category |  |
| SZ30101 | 03-13 | feat | [VAD][GoLive] Make the storing of Pharmacy orders configurable per ... |  |
| SZ30071 | 03-12 | feat | [SD409283][VAD][GoLive] Interface Misinterprets Frequency for Tube ... |  |
| SZ30083 | 03-12 | feat | EPO Inbound orders unexpectedly show  Dose Value & Dose Unit Stored... |  |
| SZ29433 | 03-08 | bug | [VAD][Inbound] Automatically Consolidate Duplicate Orders between... |  |
| SZ29959 | 03-04 | bug | [Inbound][DSS]hl7dsspharm.scm needs to look to PSAT for info not iv... |  |
| SZ29729 | 02-16 | feat | [HL7] add more logging to help trouble shooting |  |

## 2024 (10)

| SZ | Date | Type | Title | Pack |
| -- | ---- | ---- | ----- | ---- |
| SZ29401 | 12-18 | bug | [Inbound][SD404838][NPC][VAD]EPO INP fluids should not have a Frequ... |  |
| SZ29227 | 11-25 | bug | [Inbound][DSS]The order can't be displayed by send hl7 message if t... |  |
| SZ29189 | 11-20 | feat | [Inbound][DSS] cql/lisp/hl7.dss/config.dsspharm/hl7dsspharm.scm... |  |
| SZ29119 | 11-15 | feat | [Inbound][DSS]IV Drug Interface orders need to act like CPOE orders... |  |
| SZ29101 | 11-13 | feat | [Inbound][DSS]Make tubefeeding orders create a chartable fluid row ... |  |
| SZ28191 | 10-16 | feat | Slowness during adding multiple orders |  |
| SZ28692 | 09-27 | bug | [Inbound] Item not storing in hl7vital.scm with units of measure ma... |  |
| SZ27656 | 08-09 | feat | [Inbound][DSS][SD405681]hl7dsspharm.scm needs to store IVD/INP to b... |  |
| SZ27281 | 05-09 | feat | [SD403306] Anatomic Pathology Report for EHR2 Customers |  |
| SZ27197 | 03-14 | bug | [SD404917] ncqllog does not display the Patid number correctly in t... |  |

## 2023 (15)

| SZ | Date | Type | Title | Pack |
| -- | ---- | ---- | ----- | ---- |
| SZ26626 | 12-04 | feat | , [Inbound][DSS][SD402210]Configuration option to DC Restraint orde... |  |
| SZ26588 | 11-16 | feat | , The CQL path in scripts is incorrect |  |
| SZ26593 | 11-16 | feat | , [Inbound][DSS][SD402027][Pathology] Store specimen site to Pathol... |  |
| SZ26568 | 11-15 | feat | , [Inbound][DSS][SD402027] Store Accession Number to Radiology note |  |
| SZ26557 | 11-13 | feat | : [Inbound][DSS][SD402027]Store Accession Number to Pathology note |  |
| SZ26448 | 11-07 | feat | , [MLIP] Upgrade CQL Menu to run with latest node version |  |
| SZ26414 | 10-18 | feat | : [Inbound][DSS][SD402027]Store specimen source to Pathology note |  |
| SZ26121 | 08-23 | feat | , [Inbound][DSS][SD392270]Make storing of Outpatient Pharm Orders c... |  |
| SZ26020 | 08-08 | bug | : [SD401544][Txlog][Print] Fetal Strip fails to print when "PrintLo... |  |
| SZ26076 | 07-19 | bug | , [SD364347] MacLab Vitals Inbound HL7 interface: not allow overwri... |  |
| SZ25897 | 06-20 | feat | , [SD400820][VA] IVD and INP CPRS interfaced orders - hl7dsspharm.scm |  |
| SZ25788 | 04-19 | bug | , Note report fails to print when "PrintLocalPDF.RouteNumber" is gr... |  |
| SZ25704 | 03-28 | bug | , Note report fails to print when PrintLocalPDF.RouteNumber is grea... |  |
| SZ25618 | 03-09 | feat | , Cloud-based local-printing - exitcare discharge instructions pdf ... |  |
| SZ25394 | 01-04 | feat | : cqllog need to bypass the unknown vdata field type. |  |

## 2022 (9)

| SZ | Date | Type | Title | Pack |
| -- | ---- | ---- | ----- | ---- |
| SZ25052 | 10-03 | bug | , [Inbound][SD397464][HL7]Check before adding duplicate DC for exte... |  |
| SZ25051 | 09-30 | feat | , [Inbound][SD397464][HL7]Increase External_Order minorIT limit to ... |  |
| SZ24963 | 09-08 | feat | , [DSS][SD397140]Orders Inbound interface for VA hl7dsstxorders.scm... |  |
| SZ24721 | 08-16 | feat | : The files and directories only different in upper and lower cases |  |
| SZ24462 | 03-09 | feat | , [OutboundRep] a script to compare patient data |  |
| SZ24426 | 03-01 | feat | , [OutboundRep][Print][SD393312] Using c/c++ to generate cqllog fil... |  |
| SZ24229 | 02-23 | feat | , [SD390743]Increase RA numbers |  |
| SZ24268 | 01-08 | feat | , BCMA Interface needs to support ZBC-1 in ST or CM format |  |
| SZ24259 | 01-05 | bug | : [MLIP][Performance] do not check and reload of staff.m in sidlook... |  |

## 2021 (19)

| SZ | Date | Type | Title | Pack |
| -- | ---- | ---- | ----- | ---- |
| SZ24072 | 12-24 | feat | , [MLIP][Performance] speed up /ccsrc/swig/userPreferenceLib/cclib.h |  |
| SZ24173 | 12-21 | bug | , SCC vitals interface needs to use time in OBX-14, not OBR-7 |  |
| SZ24075 | 12-13 | feat | . [MLIP][Performance] rewrite /ccsrc_dev/util/events/eserver.sh usi... |  |
| SZ24117 | 12-02 | bug | , [Interface] Annotations do not show on received vitals from Welch... |  |
| SZ24074 | 11-11 | feat | [Inbound] Store placer order id and parent order id for inbound ORU |  |
| SZ23815 | 09-15 | bug | . [DSS][Inbound][SD390103]hl7dsspharm.scm need to handle blank prov... |  |
| SZ23726 | 08-19 | feat | . [Hill-Rom / Welch Allyn] Include hl7common/hl7welch.scm to Makefile |  |
| SZ23619 | 08-14 | feat | . Hill-Rom / Welch Allyn receive vitals observations directly to pa... |  |
| SZ23618 | 08-04 | feat | , [SD364347]MacLab Vitals Inbound HL7 interface |  |
| SZ22873 | 06-17 | feat | . [DSS][SD383862]Start Date problem needs to be handled in hl7dssph... |  |
| SZ23393 | 05-23 | feat | , [DSS][Inbound] Comment out logging in hl7labutil.scm |  |
| SZ23159 | 04-22 | bug | , Cppcheck: cppcheck reports more errors |  |
| SZ23164 | 04-07 | feat | . The hl7mdm.scm add by SZ 22434 needs to be added to Makefile |  |
| SZ23036 | 03-26 | feat | . [DSS][SD385116]Need to handle stoptime format in hl7dsstxorders.scm |  |
| SZ23092 | 03-25 | bug | : Unlink the temp file if it is not used anymore. |  |
| SZ22740 | 03-22 | feat | . cppcheck: Uninitialized variable |  |
| SZ22434 | 03-12 | feat | . [SD378030][Notes] Store the EKG PDF created by the Philips IBE in... |  |
| SZ22741 | 01-18 | bug | . cppcheck: Other errors |  |
| SZ22667 | 01-07 | feat | . [PythonAPI] python API interface to ccidb |  |

## 2020 (15)

| SZ | Date | Type | Title | Pack |
| -- | ---- | ---- | ----- | ---- |
| SZ22693 | 12-17 | bug | , [DSS]Vitals Inbound Interface - case that causes cql crash |  |
| SZ22649 | 12-14 | feat | , [DSS][SD382582]Vitals Inbound Interface - Need to store the user ... |  |
| SZ21987 | 10-13 | feat | . Update EBTU and BTU to support VISN9 |  |
| SZ22052 | 08-10 | feat | . [DSS][SD378640]hl7bcma.scm needs to deal with case of RXA-7 with ... |  |
| SZ21803 | 06-20 | feat | : [MU3][SLI Test Day 4] Finding - (f)(1) - Completion Status Requir... |  |
| SZ21764 | 06-17 | bug | : [MU3][SLI Test Day 2]Finding Immunization tests missing Schedule ... |  |
| SZ21587 | 05-29 | feat | , [Inbound][DSS][SD376134]hl7dsstxorders.scm needs to deal with dia... |  |
| SZ21570 | 05-22 | feat | . [Inbound][DSS][SD375276]hl7dsstxorders.scm needs configurable DC ... |  |
| SZ21407 | 05-05 | feat | : [MU3] Review of the SLI Client Test Script for Immunization - com... |  |
| SZ21440 | 04-30 | feat | . [Inbound][DSS][SD375231]hl7dsstxorders.scm needs to deal with tre... |  |
| SZ21287 | 04-11 | feat | . Store external patient data |  |
| SZ21239 | 03-23 | feat | [SD374064] [EHR] [Notes] [QC] [v213.02.217] [QSV10] [SZ 21227] exit... |  |
| SZ21218 | 03-19 | feat | , [DSS][SD373886]hl7oru.scm stopped storing needed info into 14074 ... |  |
| SZ21178 | 03-17 | feat | , [DSS][SD373643]hl7bcma.scm needs to deal with & in UNIT field |  |
| SZ20898 | 02-04 | feat | , [Inbound][SD371390]RECIEVED_UNITS needs to be appended using real... |  |

## 2019 (16)

| SZ | Date | Type | Title | Pack |
| -- | ---- | ---- | ----- | ---- |
| SZ19214 | 12-18 | feat | : [YCQL][Performance] Speed Up CCIDB Access |  |
| SZ20763 | 12-18 | feat | . [Inbound][SD367397] Inbound Order StopTime Before StartTime |  |
| SZ20374 | 10-08 | feat | , [Inbound]RECEIVED_UNITS improvements |  |
| SZ20359 | 08-28 | feat | . [Inbound][SD367522]Use ORCaction.cf to determine DC action - hl7d... |  |
| SZ20351 | 08-23 | feat | , [Inbound][SD367523]Make Restraint orders stop at 2359 on the star... |  |
| SZ20211 | 08-14 | feat | , Audit Log function in hl7adt.scm called twice in hl7-a02-1 |  |
| SZ20190 | 07-16 | feat | , [SD366045] Data stored without valid sid |  |
| SZ20171 | 07-10 | feat | . [Inbound[SD365395]Always process DC orders - hl7dsspharm.scm |  |
| SZ20081 | 06-19 | feat | , [DSS][SD365020]Make Pharmacy Orders starttime the MSH time |  |
| SZ20109 | 06-14 | bug | , [Inbound][SD365292]Fluid name with & causes crash - hl7dsspharm.scm |  |
| SZ20052 | 05-27 | feat | . [DSS][Inbound][SD364043]Nursing orders with no DC time need to de... |  |
| SZ19964 | 04-26 | feat | , [Inbound][SD363631]Store certain ADT items in the interface only ... |  |
| SZ19834 | 03-30 | feat | , [DSS][Inbound][SD362590]Skip Outpatient Meds in hl7dsspharm.scm |  |
| SZ19797 | 03-22 | feat | , [DSS][Inbound][SD362677]Pharmacy interface needs to deal with rou... |  |
| SZ19633 | 02-22 | feat | . [DSS][Inbound][SD361720]Pharmacy order adjustments needed - hl7ds... |  |
| SZ19307 | 01-03 | bug | , [Inbound][SD360070]Error processing message HL7 interface hl7-a18... |  |

## 2018 (28)

| SZ | Date | Type | Title | Pack |
| -- | ---- | ---- | ----- | ---- |
| SZ19194 | 12-11 | feat | , [Inbound[SD359117]hl7adt.scm A11 processing - Add new hl7-a11-a03-2 |  |
| SZ19086 | 11-21 | feat | . [Inbound][SD358636]Medication Name in hl7dsspharm.scm |  |
| SZ18807 | 09-28 | feat | . [Inbound[SD354629]DC Rad order using OBR-22 from Rad Result message |  |
| SZ18894 | 09-28 | feat | . [DSS][SD356632]Consult Orders for hl7dsstxorders.scm -adjustments |  |
| SZ18846 | 09-25 | feat | . [DSS][SD356632]Consult Orders for hl7dsstxorders.scm - Add to ord... |  |
| SZ16708 | 09-20 | feat | , [Inbound][SD337339]Add logging into patient databases for Inbound... |  |
| SZ18803 | 09-11 | bug | , [Inbound][SD356735]CQL crash using hl7dsstxorders.scm Nursing Orders |  |
| SZ18768 | 09-05 | feat | . [DSS][Inbound][SD356344]BCMA needs to treat a ML med delivery lik... |  |
| SZ18435 | 08-29 | bug | : [MU3]Some test cases of SZ 16301 are missing |  |
| SZ18676 | 08-14 | feat | , [MLIP][Inbound][SD355666] Inbound:Tubefeeding order - TRT |  |
| SZ18627 | 07-30 | feat | , [Inbound][SD355321]Repeating frequency segment for Pharm Orders h... |  |
| SZ18554 | 07-19 | feat | , [RapidInstall] [SD354372] ARCHIVE.nogo |  |
| SZ18568 | 07-19 | feat | , [Inbound][SD354629]Radiology Order and Report additional features |  |
| SZ18596 | 07-19 | feat | , [Inbound][SD354891]Pharmacy Orders/Delivery adjustments for hl7ds... |  |
| SZ18602 | 07-19 | feat | . Please remove .dosu and add add a check for execution as cis user... |  |
| SZ18421 | 07-17 | feat | . [MLIP] use unsigned 16bit for majorIT |  |
| SZ18555 | 07-03 | feat | , [Inbound][SD324095]All Nursing Orders for hl7dsstxorders.scm - Or... |  |
| SZ9972 | 06-27 | feat | , Make ALL Char Type DB Items VChar |  |
| SZ18544 | 06-26 | bug | , [Inbound][SD354494]Nursing Orders hl7dsstxorders.scm crashes |  |
| SZ18390 | 06-11 | feat | , [Inbound][SD324095]Consult Orders for hl7dsstxorders.scm - Order ... |  |
| SZ18440 | 06-08 | feat | , [DSS][Inbound][SD353770]BCMA need to handle repeating unit field |  |
| SZ17672 | 06-04 | bug | , [RHEL7] Fix the bug of type Wtautological-unsigned-zero-compare |  |
| SZ18279 | 04-26 | feat | , [Inbound][SD324095]Consult Orders  for hl7dsstxorders.scm Adjustm... |  |
| SZ18068 | 04-02 | feat | , [DSS][Inbound]Med IEN in hl7dsspharm.scm |  |
| SZ18030 | 02-13 | feat | , [DSS][SD349154]Diet order numbers in hl7dsstxorders.scm |  |
| SZ18001 | 01-23 | bug | , [RHEL7] cqldump return error when dump 2225 |  |
| SZ17917 | 01-12 | feat | , [DSS][SD348173]hl7dsstxorders.scm needs to handle orders that are... |  |
| SZ17783 | 01-09 | bug | . [RHEL7] Fix the bug of type Wtautological-pointer-compare |  |

## Pre-2018 (summary)

- 2017: 37 SZs
- 2016: 25 SZs
- 2015: 11 SZs
- 2014: 13 SZs
- 2013: 29 SZs
- 2012: 36 SZs
- 2011: 28 SZs
- 2010: 28 SZs
- 2009: 43 SZs
- 2008: 20 SZs
- 2007: 5 SZs
- 2006: 12 SZs
- 2005: 17 SZs
- 2004: 8 SZs
