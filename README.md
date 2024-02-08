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