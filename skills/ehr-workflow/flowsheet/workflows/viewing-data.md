# Viewing Flowsheet Data

> Companion to `skills/ehr-workflow/flowsheet/SKILL.md`. Read this file when your task involves **viewing/inspecting charted data** — annotations, edit history, item details (Describe Item), the Vitals Snapshot, or truncated comments.
> Source: EHR Online Help `Working_with_Flowsheets/Viewing_Flowsheet_Data.htm`. Adding/editing annotations: [annotations.md](annotations.md).

## Viewing an annotation

An **Annotation icon** in a data cell denotes annotations (see [annotations.md](annotations.md)). Two ways to view:

- **Select the data cell**, then select the **Annotation** icon, **or right-click** and select **Annotation** → the **Annotation dialog** displays.
- **Hover over the Annotation icon** to see a tooltip listing the annotation.

## Viewing the edit history

- **Select a data cell** and select the **Edit History** icon → the **Edit History dialog** displays the complete edit history of the flowsheet data.

## Viewing item information (Describe Item)

- **Select a data cell** and select the **Describe Item** icon → the **Describe Item dialog** shows the database item's **full name, display name, internal name, value**, **when** the data was charted, and **by whom** (plus configured reference info such as age range / vitals range).

## Viewing a Vitals Snapshot

Select the **Vitals Snapshot** icon to view vital signs and other key physiologic findings from within any configured flowsheet:

- The dialog shows the **latest 72 hours** of vital signs and other site-configurable data.
- **Mirrors** the data in the Vital Signs section of the Vitals flowsheet for the selected environment; the **column selected in the flowsheet** mirrors the **last hour column displayed** in the dialog.
- If there is **no direct column match**, the **most recent column within the selected hour** displays.
- The dialog **stays open until you close it**, so you can view data while charting; **drag it around the screen** for improved viewing/editing of the flowsheet.
- **Adjust the date range** with the **date range slider** tool — move the sliders to narrow/expand; select the **left/right arrows** to see 72 hours of vitals at a time; select the **far right arrow** to see the **last 72 hours**.
- Select the **Admit Date** icon to display vitals **from the admit date to present**.

## Viewing a comment

- Long comments in a flowsheet section may be **truncated** by your site (**default: 250 characters**). A truncated comment shows an **ellipsis**; **hover over the comment** to see a tooltip with the complete comment.
