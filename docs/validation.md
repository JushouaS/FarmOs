# Checking the system against the real flock

The weights, bird counts and behavior alerts are estimates. The error figures the app shows today come from a held-out test
on another flock (the Kinect weight, about 18% for one bird) or are placeholders (the Test video's 20%). Before anyone
decides anything from them on your farm, measure them here. This is plan.md tasks T2.7, T2.8 and T2.9.

Fill in the three files in `docs/templates/` (a spreadsheet program can save CSV), then run the report:

```bash
cd gleam-screen-creator-main/packages/api
npx tsx scripts/validation-report.ts weight   ../../../docs/templates/weight.csv
npx tsx scripts/validation-report.ts count    ../../../docs/templates/count.csv
npx tsx scripts/validation-report.ts behavior ../../../docs/templates/behavior.csv
```

Keep the filled-in files (for example in `docs/validation-data/`) with the date: they are the evidence for the numbers you
show farmers, and `cerebroil-stream/train_weight_model.py` can retrain the weight model from them later.

## 1. Weight (the Kinect against a scale)

**Aim:** know how far the Kinect's weight for one bird, and for the flock's average, is from the scale. **Target:** the flock's
average within 5% on each day, over 3 different days, with at least 30 birds a day.

**Before you start:** the Kinect bridge and the chicken finder are running; Live Camera shows the Kinect Picture view with
outlines and weights; the scale is checked with a known weight (a 1 kg bag of sugar, say).

**For each bird (about 30 a day, on 3 different days, ideally days that are a week apart):**
1. Weigh the bird on the scale and write the weight in grams.
2. Put the same bird alone in the Kinect's weighing area, as it will be in normal use. Wait until its outline and a number
   appear on the screen. Write the number shown on the bird.
3. Type the scale weight into Flock Tracking too (this also feeds the Dashboard average).

**Record:** one row a bird in `weight.csv`: `date, day` (grow-out day), `bird_id` (B-001 and up), `scale_g`, `kinect_g`,
`notes` (the bird moved, two birds in view, and so on).

**Read the result:** "Bias" above 0 means the Kinect reads heavy. "One bird is off by" is the figure to show in the app instead
of 18%. If the flock average is outside 5% on a day, collect more birds before changing anything; if it stays outside,
retrain the model with your own data (`train_weight_model.py`, see HOW_TO_RUN.md, section 7).

## 2. Count (the detector against a person)

**Aim:** know how many birds the "Analyze data" count gets wrong. **Target:** total error 10% or less over 20 pictures.

**For each of 20 pictures** (different times of day, including night with the infrared light, and different crowding):
1. Open Live Camera, press **Analyze data**, and note the count it shows.
2. Take a screenshot of the same moment. Count the birds in the picture yourself, by clicking each one off in an image
   editor, and note the number. Two people counting separately and agreeing is better.

**Record:** one row a picture in `count.csv`: `date`, `frame_id` (any name), `manual_count`, `detector_count`.

**Read the result:** the "Worst pictures" line shows which situations fail. A detector that misses birds in a crowd or at
night is the signal to collect those pictures for retraining.

## 3. Behavior (the alerts against what a person sees)

**Aim:** know how many inactive-bird and huddling alerts are real, and how many real episodes raise none.

**Before you start:** `LIVE_BEHAVIOR=1` is set on the Pi and Live Camera's Behavior Breakdown shows numbers.

**For two hours of daytime video** (record it, or watch live) and the alerts of the same two hours (Alerts page):
1. Write down every episode you see: birds that stay still for a long time while the rest move, or a group packed together.
2. Match them with the alerts. Each episode gets one row, whether or not an alert came; each alert with no episode gets one too.

**Record:** `behavior.csv` rows of `date, kind` (`inactive` or `huddling`), `observed` (yes or no), `alerted` (yes or no), `notes`.

**Read the result:** "Alerts that were real" under 70% means too many false alarms, so lengthen `LIVE_INACTIVE_SECONDS` or
`LIVE_HUDDLE_SECONDS` in the Pi's `.env`; "Episodes that raised an alert" under 70% means it misses real ones, so shorten
them. Repeat with a second two-hour period after changing a value. Fewer than 10 episodes is too few to judge.

## After the numbers are in

- Put the measured one-bird weight error where the app says "about 18%": `typical_error_percent` in
  `cerebroil-stream/kinect_weight.py` (it reads the model's metadata file, `models/weight_model_size_v1.meta.json`) gives the
  number that `kinect_seg.py` sends and `KinectDepthView.tsx` shows. The Test video's 20% is in `src/lib/farm/video-weight.ts`.
- If the count error is above 10%, add a caution on Live Camera and collect the failing pictures for retraining.
- Write the results, with dates and sample sizes, at the bottom of this file so the next person can see what was measured.

## Results

_Nothing measured yet._
