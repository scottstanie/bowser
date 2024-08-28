# Bowser

## Install

```bash
mamba env create
pip install .
```

Note: if viewing files on S3, please install `s5cmd`:

```bash
mamba install s5cmd
```

## Quickstart for dolphin

- `bowser setup-dolphin` is preconfigured to make a JSON file pointing to the outputs inside `work_directory` of dolphin
- `bowser run` starts the web server on `localhost`:

```
$ bowser setup-dolphin work/
Reading raster metadata: 100%|████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████| 2/2 [00:00<00:00, 236.13it/s]
Reading raster metadata: 100%|█████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████| 2/2 [00:00<00:00, 95.74it/s]
Reading raster metadata: 100%|████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████| 2/2 [00:00<00:00, 266.77it/s]
Reading raster metadata: 100%|████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████| 1/1 [00:00<00:00, 100.49it/s]
Reading raster metadata: 100%|█████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████████| 1/1 [00:00<00:00, 94.88it/s]

$ bowser run
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Started parent process [99855]
...
```

Click on the `http://127.0.0.1:8000` link to open the map.


**Note for running over ssh**: you will need to run an ssh command creating a tunnel from your local computer to wherever the `bowser` server is.
For example, if you machine is `aurora`, you would run in a local terminal

```
ssh -N -L 8000:localhost:8000 aurora
```
after starting the web server.

## Quickstart for DISP-S1 NetCDFs

Until GDAL puts work into the NetCDF driver, reading remote files has very poor support (also, there is no standard overview format. So `titiler` is very unhappy).

So, the recommended way to view some timeseries of frames is

1. Download the NetCDFs (hopefully on some server which has fast access to the S3 bucket).
2. Run `bowser prepare-disp-s1` to create VRT files pointing in the `.nc` files, one per dataset we wish to browse.
3. Run `bowser setup-disp-s1` to make a JSON file containing all the file metadata, so the browser knows where to look.
4. `bowser run`

In detail:

1. Download
I use [`s5cmd`](https://github.com/peak/s5cmd) for faster copying, but the `aws` CLI tool works too:

```bash
mkdir my_disp_files; cd my_disp-files
s5cmd --numworkers 4 cp 's3://opera-bucket/OPERA_L3_DISP-S1_IW_F11115*/OPERA_L3_DISP-S1_IW_F11115*.nc' .
```

2. Extract VRTS

```bash
bowser prepare-disp-s1 -o vrts *.nc
```

3. Create `bowser_rasters.json` metadata

```bash
bowser setup-disp-s1 vrts
```

4. Run

```bash
bowser run
```

If this is on a server instead of your laptop, you'll need (on your laptop)

```
ssh -N -L 8000:localhost:8000 aurora
```
for whatever port pops up after `bowser run`


## CLI Usage

```bash
$ bowser --help
Usage: bowser [OPTIONS] COMMAND [ARGS]...

  CLI for bowser.

Options:
  --help  Show this message and exit.

Commands:
  addo           Add compressed GDAL overviews to files.
  run            Run the web server.
  set-data       Specify what raster data to use.
  setup-dolphin  Set up output data configuration for a dolphin workflow.
```

To manually specify a raster/set of rasters, use the interactive `bowser set-data`