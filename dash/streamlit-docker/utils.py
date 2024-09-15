import os
import time
from functools import lru_cache
import requests
import geopandas as gpd
from datetime import datetime
import pandas as pd
import numpy as np
import streamlit as st
import plotly.express as px
import folium
from io import BytesIO
import pytz
from shapely.geometry import Point
import pyarrow.parquet as pq
from shapely import wkb

@st.cache_data(ttl=300)  # Increased TTL to 5 min
def load_data(selected_day):
    tz = pytz.timezone('America/New_York')
    formatted_day = selected_day.replace(' ', '+')
    current_date = datetime.now(tz).strftime("%Y%m%d")
    
    cloudfront_url = os.environ.get('CLOUDFRONT_URL', 'https://heat-risk-dashboard.s3.amazonaws.com')
    url = f'{cloudfront_url}/heat_risk_analysis_{formatted_day}_{current_date}.geoparquet'

    start_time = time.time()

    try:
        print(f"Downloading {url}...")
        with requests.get(url, stream=True) as response:
            response.raise_for_status()
            data = BytesIO(response.content)
        
        # Use pyarrow to read the Parquet file
        table = pq.read_table(data)
        df = table.to_pandas()

        # Convert the geometry column from WKB to shapely geometries
        df['geometry'] = df['geometry'].apply(lambda x: wkb.loads(x) if x else None)

        # Create GeoDataFrame and set the geometry column
        gdf = gpd.GeoDataFrame(df, geometry='geometry', crs="EPSG:4326")

        end_time = time.time()
        download_time = end_time - start_time
        
        print(f"Download and processing completed in {download_time:.2f} seconds")
        # st.success(f"Data loaded successfully in {download_time:.2f} seconds")

        return gdf

    except requests.exceptions.RequestException as e:
        end_time = time.time()
        download_time = end_time - start_time

        st.error(f'{current_date},{url}')
        st.error(f"Failed to download data: {e}")
        print(f"Download failed after {download_time:.2f} seconds")
        return None
    
    except Exception as e:
        end_time = time.time()
        download_time = end_time - start_time

        st.error(f"An error occurred while loading the data: {e}")
        print(f"Data loading failed after {download_time:.2f} seconds")
        return None

@lru_cache(maxsize=None)
def load_state_county_zip_data():
    states_file = "data/us_states_reduced.parquet"
    counties_file = "data/us_counties_reduced.parquet"
    zipcodes_file = "data/us_zipcodes_reduced.parquet"

    states = gpd.read_parquet(states_file)
    counties = gpd.read_parquet(counties_file)
    zipcodes = gpd.read_parquet(zipcodes_file)

    for gdf in [states, counties, zipcodes]:
        if not gdf.crs.is_geographic:
            gdf.to_crs(epsg=4326, inplace=True)

    return states, counties, zipcodes

@lru_cache(maxsize=1000)
def get_zipcode_boundary(zip_code):
    _, _, zipcodes = load_state_county_zip_data()
    column_name = 'ZCTA5CE10'
    return zipcodes[zipcodes[column_name] == str(zip_code)]

def load_geographic_data():
    states, counties, _ = load_state_county_zip_data()

    state_names = ["Select a State"] + sorted(states['NAME'].unique())
    selected_state = st.sidebar.selectbox("Select State", state_names)

    if selected_state != "Select a State":
        filtered_counties = counties[counties['STATE_NAME'] == selected_state]
        county_names = ["Select a County"] + sorted(filtered_counties['NAME'].unique())
    else:
        county_names = ["Select a County"]

    selected_county = st.sidebar.selectbox("Select County", county_names)

    zip_code = st.sidebar.text_input("Enter ZIP Code to Zoom In", placeholder="e.g., 10044")
    zipcode_boundary = get_zipcode_boundary(zip_code) if zip_code else None

    return states, counties, selected_state, selected_county, zipcode_boundary

def generate_column_mapping(columns, prefix='weighted_', replacement='weighted ', title_case=True):
    if title_case:
        return {col: col.replace(prefix, replacement).replace('_', ' ').title() for col in columns if col.startswith(prefix)}
    else:
        return {col: col.replace(prefix, replacement).replace('_', ' ') for col in columns if col.startswith(prefix)}

def move_column_to_front(columns, column_name):
    if column_name in columns:
        return [column_name] + [col for col in columns if col != column_name]
    return columns

@lru_cache(maxsize=None)
def load_hhi_description(file_path='data/HHI_Data_Dictionary_2024.csv'):
    return pd.read_csv(file_path)

def get_hhi_indicator_description(hhi_desc_df, indicator_name):
    try:
        return hhi_desc_df.loc[hhi_desc_df['weighted_2024_VARIABLE_NAME'] == indicator_name, '2024_DESCRIPTION'].values[0]
    except IndexError:
        return "No description available for this indicator."

def get_heat_risk_levels_description():
    return """
    **Heat Risk Levels:**
    
    - **0:** Little to no risk from expected heat.
    - **1:** Minor - This level of heat affects primarily those individuals extremely sensitive to heat, especially when outdoors without effective cooling and/or adequate hydration.
    - **2:** Moderate - This level of heat affects most individuals sensitive to heat, especially those without effective cooling and/or adequate hydration. Impacts possible in some health systems and in heat-sensitive industries.
    - **3:** Major - This level of heat affects anyone without effective cooling and/or adequate hydration. Impacts likely in some health systems, heat-sensitive industries, and infrastructure.
    - **4:** Extreme - This level of rare and/or long-duration extreme heat with little to no overnight relief affects anyone without effective cooling and/or adequate hydration. Impacts likely in most health systems, heat-sensitive industries, and infrastructure.
    """

@lru_cache(maxsize=None)
def project_single_geometry(geom, from_crs, to_crs):
    return gpd.GeoSeries([geom], crs=from_crs).to_crs(to_crs)[0]

def project_geometries(geometries, from_crs, to_crs):
    if isinstance(geometries, (list, tuple)):
        return [project_single_geometry(geom, from_crs, to_crs) for geom in geometries]
    else:
        return project_single_geometry(geometries, from_crs, to_crs)

def create_map(layer1_with_weighted_values, selected_hhi_indicator, heat_threshold, heat_health_index_threshold, selected_state, selected_county, states, counties, zipcode_boundary=None):
    if layer1_with_weighted_values.empty:
        st.warning("The data is empty. Please check your inputs.")
        return None

    percentile_threshold = np.percentile(layer1_with_weighted_values[selected_hhi_indicator], heat_health_index_threshold)

    highlighted_areas = layer1_with_weighted_values.copy()
    highlighted_areas['highlight'] = (
        (highlighted_areas[selected_hhi_indicator] >= percentile_threshold) & 
        (highlighted_areas['raster_value'].isin(heat_threshold))
    )

    # Project all geometries to EPSG:5070 once
    highlighted_areas_projected = highlighted_areas.to_crs(epsg=5070)
    states_projected = states.to_crs(epsg=5070)
    counties_projected = counties.to_crs(epsg=5070)

    selected_state_geom = states_projected.loc[states_projected['NAME'] == selected_state, 'geometry'].values[0] if selected_state != "Select a State" else None
    selected_county_geom = counties_projected.loc[(counties_projected['STATE_NAME'] == selected_state) & (counties_projected['NAME'] == selected_county), 'geometry'].values[0] if selected_county != "Select a County" and selected_state_geom is not None else None

    initial_location = Point(highlighted_areas_projected.geometry.centroid.x.mean(), highlighted_areas_projected.geometry.centroid.y.mean())
    initial_zoom = 4

    if zipcode_boundary is not None:
        zipcode_boundary_projected = zipcode_boundary.to_crs(epsg=5070)
        initial_location = zipcode_boundary_projected.geometry.centroid.iloc[0]
        initial_zoom = 13
    elif selected_county_geom is not None:
        initial_location = selected_county_geom.centroid
        initial_zoom = 8
    elif selected_state_geom is not None:
        initial_location = selected_state_geom.centroid
        initial_zoom = 6

    # Project initial_location back to EPSG:4326 for Folium
    initial_location = project_geometries(initial_location, from_crs='EPSG:5070', to_crs='EPSG:4326')
    initial_location = [initial_location.y, initial_location.x]

    m = folium.Map(location=initial_location, zoom_start=initial_zoom)

    if selected_state_geom is not None:
        folium.GeoJson(project_geometries(selected_state_geom, from_crs='EPSG:5070', to_crs='EPSG:4326'), 
                       name="State Boundary", 
                       style_function=lambda x: {'color': 'green', 'weight': 2, 'fillOpacity': 0.1}).add_to(m)

    if selected_county_geom is not None:
        folium.GeoJson(project_geometries(selected_county_geom, from_crs='EPSG:5070', to_crs='EPSG:4326'), 
                       name="County Boundary", 
                       style_function=lambda x: {'color': 'yellow', 'weight': 2, 'fillOpacity': 0.7}).add_to(m)

    if zipcode_boundary is not None:
        folium.GeoJson(zipcode_boundary.to_crs(epsg=4326).geometry, 
                       name="ZIP Code Boundary", 
                       style_function=lambda x: {'color': 'black', 'weight': 3, 'fillOpacity': 0.5}).add_to(m)

    folium.GeoJson(
        highlighted_areas.to_crs(epsg=4326),
        style_function=lambda feature: {
            'fillColor': 'red' if feature['properties']['highlight'] else 'blue',
            'color': 'black',
            'weight': 0.1,
            'fillOpacity': 0.7 if feature['properties']['highlight'] else 0.3,
        },
        tooltip=folium.GeoJsonTooltip(
            fields=[selected_hhi_indicator, 'raster_value'],
            aliases=[selected_hhi_indicator.replace('weighted_', ''), 'Heat Risk Level:'],
            localize=True,
            sticky=True
        )
    ).add_to(m)

    legend_html = f'''
        <div style="position: fixed; bottom: 50px; left: 50px; width: 220px; height: 90px; 
                    border:2px solid grey; z-index:9999; font-size:14px;
                    background-color:white;
                    ">
        &nbsp; Legend <br>
        &nbsp; <i class="fa fa-square fa-1x"
                    style="color:red"></i> Highlighted Areas (Heat Risk {heat_threshold} & HHI {heat_health_index_threshold}th percentile)<br>
        &nbsp; <i class="fa fa-square fa-1x"
                    style="color:blue"></i> Other Areas
        </div>
        '''
    m.get_root().html.add_child(folium.Element(legend_html))

    return m


def create_plot(data, y_column, x_column, color_column, title, y_label, x_label, height=300, width=600):
    fig = px.bar(data, 
                 y=y_column, 
                 x=x_column, 
                 color=color_column,
                 labels={y_column: y_label, x_column: x_label},
                 title=title,
                 orientation='h',
                 height=height,
                 width=width)
    fig.update_layout(barmode='stack')
    return fig