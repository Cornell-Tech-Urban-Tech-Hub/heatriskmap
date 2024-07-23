import os
import requests
import zipfile
import numpy as np
import pandas as pd
import geopandas as gpd
import rasterio
from rasterio.features import shapes
from pyproj import CRS
import boto3
from datetime import datetime

# Helper functions
def download_file(url, local_filename):
    if not os.path.exists(local_filename):
        print(f"Downloading {url}...")
        response = requests.get(url)
        response.raise_for_status()
        with open(local_filename, 'wb') as file:
            file.write(response.content)
        print(f"Saved to {local_filename}")
    else:
        print(f"{local_filename} already exists.")

def geotiff_to_geodataframe(file_path):
    with rasterio.open(file_path) as src:
        image = src.read(1)
        mask = image != src.nodata
        results = (
            {'properties': {'raster_value': v}, 'geometry': s}
            for i, (s, v) 
            in enumerate(shapes(image, mask=mask, transform=src.transform))
        )
        geoms = list(results)
    
    gdf = gpd.GeoDataFrame.from_features(geoms, crs=src.crs)
    return gdf.to_crs(epsg=4326)

def convert_excel_to_parquet(excel_file_path, parquet_file_path):
    if not os.path.exists(parquet_file_path):
        df = pd.read_excel(excel_file_path)
        df.to_parquet(parquet_file_path, index=False)
        print(f"Converted {excel_file_path} to {parquet_file_path}")
    else:
        print(f"Parquet file {parquet_file_path} already exists.")

def load_heat_risk_data(data_dir):
    url_list = {
        "Day 1": "https://www.wpc.ncep.noaa.gov/heatrisk/data/HeatRisk_1_Mercator.tif",
        "Day 2": "https://www.wpc.ncep.noaa.gov/heatrisk/data/HeatRisk_2_Mercator.tif",
        "Day 3": "https://www.wpc.ncep.noaa.gov/heatrisk/data/HeatRisk_3_Mercator.tif",
        "Day 4": "https://www.wpc.ncep.noaa.gov/heatrisk/data/HeatRisk_4_Mercator.tif",
        "Day 5": "https://www.wpc.ncep.noaa.gov/heatrisk/data/HeatRisk_5_Mercator.tif",
        "Day 6": "https://www.wpc.ncep.noaa.gov/heatrisk/data/HeatRisk_6_Mercator.tif",
        "Day 7": "https://www.wpc.ncep.noaa.gov/heatrisk/data/HeatRisk_7_Mercator.tif"
    }
    
    geodataframes = {}
    for day, url in url_list.items():
        file_path = os.path.join(data_dir, f"{day}.tif")
        if not os.path.exists(file_path):
            response = requests.get(url)
            with open(file_path, 'wb') as f:
                f.write(response.content)
                print(f"Downloaded {file_path}")
        gdf = geotiff_to_geodataframe(file_path)
        geodataframes[day] = gdf
    
    return geodataframes

def load_cdc_data(data_dir):
    # Load CDC Heat and Health Index Data
    boundaries_url = "https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip"
    boundaries_zip = os.path.join(data_dir, "cb_2020_us_zcta520_500k.zip")
    if not os.path.exists(boundaries_zip):
        download_file(boundaries_url, boundaries_zip)
        with zipfile.ZipFile(boundaries_zip, 'r') as zip_ref:
            zip_ref.extractall(data_dir)
    boundaries_file = os.path.join(data_dir, "cb_2020_us_zcta520_500k.shp")
    zcta_boundaries = gpd.read_file(boundaries_file).to_crs(epsg=4326)
    
    excel_url = "https://gis.cdc.gov/HHI/Documents/HHI_Data.zip"
    excel_zip = os.path.join(data_dir, "HHI_Data.zip")
    excel_file = os.path.join(data_dir, "HHI Data 2024 United States.xlsx")
    parquet_file = os.path.join(data_dir, "HHI Data 2024 United States.parquet")
    
    if not os.path.exists(parquet_file):
        download_file(excel_url, excel_zip)
        with zipfile.ZipFile(excel_zip, 'r') as zip_ref:
            zip_ref.extractall(data_dir)
        convert_excel_to_parquet(excel_file, parquet_file)
    hhi_data = pd.read_parquet(parquet_file)
    
    hhi_data['ZCTA'] = hhi_data['ZCTA'].astype(str)
    zcta_boundaries['ZCTA5CE20'] = zcta_boundaries['ZCTA5CE20'].astype(str)
    zcta_with_hhi = zcta_boundaries.merge(hhi_data, left_on='ZCTA5CE20', right_on='ZCTA', how='inner')
    
    return zcta_with_hhi

def create_combined_map(layer1, layer2, selected_hhi_indicator, heat_threshold, heat_health_index_threshold):
    # Ensure both layers are in the same CRS
    if layer1.crs != layer2.crs:
        layer2 = layer2.to_crs(layer1.crs)

    # If the CRS is geographic, reproject to a suitable projected CRS
    if layer1.crs.is_geographic:
        utm_crs = CRS.from_epsg(5070)
        layer1 = layer1.to_crs(utm_crs)
        layer2 = layer2.to_crs(utm_crs)

    # Spatial join
    joined = gpd.overlay(layer1, layer2, how='intersection')

    # Calculate intersection area and weight
    joined['intersection_area'] = joined.geometry.area
    joined['weight'] = joined['intersection_area'] / joined.groupby(level=0)['intersection_area'].transform('sum')

    # Identify numeric columns
    numeric_columns = layer2.select_dtypes(include=[np.number]).columns.drop('geometry', errors='ignore')
    non_numeric_columns = layer2.columns.drop(numeric_columns).drop('geometry', errors='ignore')

    # Apply weight to numeric columns from layer2
    for col in numeric_columns:
        joined[f'weighted_{col}'] = joined[col] * joined['weight']

    # Handle non-numeric columns
    for col in non_numeric_columns:
        joined[f'mode_{col}'] = joined.groupby(level=0).apply(
            lambda x: pd.Series({
                col: x.loc[x['intersection_area'].idxmax(), col]
            })
        )

    # Group by original grid cells
    numeric_result = joined.groupby(level=0).agg({f'weighted_{col}': 'sum' for col in numeric_columns})
    non_numeric_result = joined.groupby(level=0).agg({f'mode_{col}': 'first' for col in non_numeric_columns})

    # Combine results
    result = pd.concat([numeric_result, non_numeric_result], axis=1)

    # Merge the result back to the original layer1
    layer1_with_weighted_values = layer1.join(result)

    # Calculate the percentile threshold
    percentile_threshold = np.percentile(layer1_with_weighted_values[f'weighted_{selected_hhi_indicator}'], heat_health_index_threshold)

    # Create a new column to flag the records we want to highlight
    layer1_with_weighted_values['highlight'] = (
        (layer1_with_weighted_values[f'weighted_{selected_hhi_indicator}'] >= percentile_threshold) & 
        (layer1_with_weighted_values['raster_value'].isin(heat_threshold))
    )

    # Ensure the GeoDataFrame is in a geographic CRS (WGS84)
    if not layer1_with_weighted_values.crs.is_geographic:
        layer1_with_weighted_values = layer1_with_weighted_values.to_crs(epsg=4326)

    return layer1_with_weighted_values

def save_to_s3(data, bucket_name, file_name):
    s3 = boto3.client('s3')
    data.to_parquet(file_name)
    s3.upload_file(file_name, bucket_name, file_name)
    print(f"Saved {file_name} to S3 bucket {bucket_name}")
    os.remove(file_name)  # Remove local file after uploading

def main():
    data_dir = "data"
    if not os.path.exists(data_dir):
        os.makedirs(data_dir, exist_ok=True)

    geodataframes = load_heat_risk_data(data_dir)
    zcta_with_hhi = load_cdc_data(data_dir)
    
    selected_hhi_indicator = "OVERALL_SCORE"
    heat_threshold = [2, 3, 4]
    heat_health_index_threshold = 80
    
    bucket_name = "your-s3-bucket-name"
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    for day, gdf in geodataframes.items():
        result = create_combined_map(gdf, zcta_with_hhi, selected_hhi_indicator, heat_threshold, heat_health_index_threshold)
        file_name = f"heat_risk_analysis_{day}_{timestamp}.geoparquet"
        save_to_s3(result, bucket_name, file_name)

if __name__ == "__main__":
    main()