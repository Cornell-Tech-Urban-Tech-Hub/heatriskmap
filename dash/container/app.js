// app.js

import * as arrow from 'https://cdn.skypack.dev/apache-arrow';
console.log("Apache arrow")
console.log(arrow);

// Initialize variables
const dataCache = {};
let deckgl;
let currentLayer = null;

// Elements
const daySelect = document.getElementById('day-select');
const riskLevelSelect = document.getElementById('risk-level-select');
const hhiIndicatorSelect = document.getElementById('hhi-indicator-select');
const percentileThreshold = document.getElementById('percentile-threshold');
const percentileValue = document.getElementById('percentile-value');
const downloadButton = document.getElementById('download-button');

// Elements
const stateSelect = document.getElementById('state-select');
const countySelect = document.getElementById('county-select');
const zipCodeInput = document.getElementById('zip-code-input');
const heatRiskLevelsInfo = document.getElementById('heat-risk-levels-info');
const hhiIndicatorInfo = document.getElementById('hhi-indicator-info');

// Load initial data
await loadStateCountyZipData();
await loadHHIDescription();
await populateInformationalBoxes();

// Function to populate informational boxes
function populateInformationalBoxes() {
    heatRiskLevelsInfo.innerHTML = `
        <p><strong>Heat Risk Levels:</strong></p>
        <ul>
            <li><strong>0:</strong> Little to no risk from expected heat.</li>
            <li><strong>1:</strong> Minor - Affects primarily those extremely sensitive to heat.</li>
            <li><strong>2:</strong> Moderate - Affects most individuals sensitive to heat.</li>
            <li><strong>3:</strong> Major - Affects anyone without effective cooling and/or adequate hydration.</li>
            <li><strong>4:</strong> Extreme - Rare and/or long-duration extreme heat with little to no overnight relief.</li>
        </ul>
    `;
}

function zoomToRegion(geometry) {
    // Calculate bounding box from the coordinates
    const coordinates = geometry.coordinates[0];
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;

    coordinates.forEach(coord => {
        const [lng, lat] = coord;
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
    });

    // Calculate the center of the bounding box
    const centerLng = (minLng + maxLng) / 2;
    const centerLat = (minLat + maxLat) / 2;

    // Calculate the bounds size to determine zoom level
    const lngDiff = maxLng - minLng;
    const latDiff = maxLat - minLat;
    const maxDiff = Math.max(lngDiff, latDiff);

    // Determine a zoom level based on the size of the bounding box
    // The zoom level formula may need tweaking 
    let zoomLevel = 10; // Default zoom level
    if (maxDiff > 0) {
        zoomLevel = Math.log2(860 / maxDiff) - 1; // Adjusting to fit the bounds in view
    }

    // Set the new view state to fit the bounding box
    deckgl.setProps({
        initialViewState: {
            longitude: centerLng,
            latitude: centerLat,
            zoom: zoomLevel,
            bearing: 0,
            pitch: 0,
            transitionDuration: 500, // Smooth transition to the new view
        }
    });

    // Create a GeoJSON feature collection for the outline layer
    const outlineFeature = {
        type: 'Feature',
        geometry: geometry,
        properties: {}
    };

    const outlineLayer = new deck.GeoJsonLayer({
        id: 'outline-layer',
        data: { type: 'FeatureCollection', features: [outlineFeature] },
        stroked: true,
        filled: false,
        lineWidthMinPixels: 2,
        getLineColor: [255, 0, 0]
    });

    // Get the current layers and update the "outline-layer" or add it if it doesn't exist
    const currentLayers = deckgl.props.layers.filter(layer => layer.id !== 'outline-layer');
    deckgl.setProps({ layers: [...currentLayers, outlineLayer] });
}



// Function to remove the focus layer
function removeFocusLayer() {
    const currentLayers = deckgl.props.layers.filter(layer => layer.id !== 'outline-layer');
    deckgl.setProps({ layers: currentLayers });
}


// Zip code input event listener
zipCodeInput.addEventListener('input', () => {
    const zipCode = zipCodeInput.value.trim();

    // Remove the current focus layer if zip code is empty
    if (zipCode === "") {
        removeFocusLayer();
        return;
    }

    // Find and zoom to the zip code area
    const zipFeature = window.zipcodesData.features.find(f => f.properties.ZCTA5CE10 === zipCode);
    if (zipFeature) {
        zoomToRegion(zipFeature.geometry);
    } else {
        console.warn('Zip code not found');
    }
});


// State select event listener
stateSelect.addEventListener('change', () => {
    const selectedState = stateSelect.value;

    // Reset county selection and populate county options based on selected state
    countySelect.innerHTML = '<option value="">Select a County</option>';

    if (selectedState !== "") {
        // Populate counties specific to the selected state
        populateCountyOptions(countiesData, selectedState);

        // Find the selected state's geometry and zoom to it
        const stateFeature = statesData.features.find(
            feature => feature.properties.NAME === selectedState
        );
        if (stateFeature) {
            zoomToRegion(stateFeature.geometry);
        }
    } else {
        // Populate all counties if no state is selected
        populateCountyOptions(countiesData);

        // Remove focus layer if "Select a State" is selected
        removeFocusLayer();
    }
});


// County select event listener
countySelect.addEventListener('change', () => {
    const selectedCounty = countySelect.value;
    const selectedState = stateSelect.value;

    // Remove the current focus layer if "Select a County" is chosen
    if (selectedCounty === "") {
        removeFocusLayer();
        return;
    }

    // Find and zoom to the selected county
    let countyFeature;
    if (selectedState !== "") {
        // Filter county within the selected state
        countyFeature = countiesData.features.find(
            feature => feature.properties.NAME === selectedCounty && feature.properties.STATE_NAME === selectedState
        );
    } else {
        // Find county without filtering by state
        countyFeature = countiesData.features.find(
            feature => feature.properties.NAME === selectedCounty
        );
    }

    if (countyFeature) {
        zoomToRegion(countyFeature.geometry);
    } else {
        console.warn('County not found.');
    }
});

// Function to load state, county, and zip data
async function loadStateCountyZipData() {
    const statesFile = 'data/us_states_reduced.parquet';
    const countiesFile = 'data/us_counties_reduced.parquet';
    const zipcodesFile = 'data/us_zipcodes_reduced.parquet';

    try {
        const statesData = await fetchGeoParquet(statesFile);
        const countiesData = await fetchGeoParquet(countiesFile);
        const zipcodesData = await fetchGeoParquet(zipcodesFile);

        // Store for future access
        window.statesData = statesData;
        window.countiesData = countiesData;
        window.zipcodesData = zipcodesData;

        // Populate state and county selects
        populateStateOptions(statesData);
        populateCountyOptions(countiesData);
    } catch (error) {
        console.error('Error loading geographic data:', error);
    }
}


// Mapbox Access Token
const MAPBOX_TOKEN = 'pk.eyJ1IjoicnlhbmhsZXdpcyIsImEiOiJjbDhkcWZzcHowbGhiM3VrOWJ3ZmtzcnZyIn0.ipWAZK-oipctMjaHytOUKQ';

// Initialize the deck.gl map
deckgl = new deck.DeckGL({
    container: 'deckgl-container',
    mapLib: mapboxgl, // Specify the Mapbox GL JS library
    mapboxApiAccessToken: MAPBOX_TOKEN,
    mapStyle: 'mapbox://styles/mapbox/light-v10',
    initialViewState: {
        longitude: -98.5795,
        latitude: 39.8283,
        zoom: 3.5,
        bearing: 0,
        pitch: 0
    },
    controller: true,
});


// Populate day options
for (let i = 1; i <= 7; i++) {
    const option = document.createElement('option');
    const date = new Date();
    date.setDate(date.getDate() + i - 1);
    option.value = `Day+${i}`;
    option.text = `Day ${i} - ${date.toLocaleDateString()}`;
    daySelect.add(option);
}

// Placeholder for HHI indicators (add as needed)
const hhiIndicators = [
    // { value: 'weighted_OVERALL_SCORE', label: 'Weighted Overall Score' },
    // { value: 'weighted_P_AGE65', label: 'Percentage of Persons Aged 65 and Older' }
];

// Populate HHI indicator options
hhiIndicators.forEach(indicator => {
    const option = document.createElement('option');
    option.value = indicator.value;
    option.text = indicator.label;
    hhiIndicatorSelect.add(option);
});

// Event listeners
daySelect.addEventListener('change', () => {
    loadDataForSelectedDay(daySelect.value);
});

riskLevelSelect.addEventListener('change', () => {
    updateMapLayer();
});

hhiIndicatorSelect.addEventListener('change', () => {
    updateMapLayer();
});

percentileThreshold.addEventListener('input', () => {
    percentileValue.textContent = percentileThreshold.value;
    updateMapLayer();
});

downloadButton.addEventListener('click', () => {
    downloadFilteredData();
});

// Load initial data
loadDataForSelectedDay(daySelect.value);

// Function to load data for the selected day
async function loadDataForSelectedDay(selectedDay) {
    const today = new Date();
    const formattedDate = today.toISOString().slice(0, 10).replace(/-/g, '');
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const formattedYesterday = yesterday.toISOString().slice(0, 10).replace(/-/g, '');

    const dataUrl = `https://heat-risk-dashboard.s3.amazonaws.com/heat_risk_analysis_${selectedDay}_${formattedDate}.geoparquet`;
    const fallbackUrl = `https://heat-risk-dashboard.s3.amazonaws.com/heat_risk_analysis_${selectedDay}_${formattedYesterday}.geoparquet`;

    try {
        const geojsonData = await fetchGeoParquetWithFallback(dataUrl, fallbackUrl);
        dataCache[selectedDay] = geojsonData;
        updateMapLayer();
    } catch (error) {
        console.error('Error loading data:', error);
        alert('Failed to load data for both today and yesterday.');
    }
}

// Function to fetch GeoParquet with fallback
async function fetchGeoParquetWithFallback(url, fallbackUrl) {
    try {
        return await fetchGeoParquet(url);
    } catch (error) {
        console.warn(`Failed to fetch data from ${url}. Trying fallback...`);
        return await fetchGeoParquet(fallbackUrl);
    }
}
// Function to fetch and parse GeoParquet using parquet-wasm
async function fetchGeoParquet(url) {
    // Import parquet-wasm
    const parquetModule = await import("https://unpkg.com/parquet-wasm@0.4.0-beta.3/esm/arrow2.js");
    await parquetModule.default(); // Initialize the WebAssembly module
    const parquet = parquetModule;

    // Fetch the GeoParquet file
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Status: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();

    // Read the GeoParquet file using parquet-wasm
    const parquetBytes = new Uint8Array(arrayBuffer);
    const decodedArrowBytes = parquet.readParquet(parquetBytes);

    // Use Arrow's RecordBatchStreamReader to parse the IPC data
    const recordBatchReader = arrow.RecordBatchStreamReader.from(decodedArrowBytes);
    
    // Collect all record batches into an array
    const recordBatches = [];
    for await (const batch of recordBatchReader) {
        recordBatches.push(batch);
    }

    // Create a table from the record batches
    const arrowTable = new arrow.Table(recordBatches);

    // Debugging logs
    console.log("Arrow Table:", arrowTable);
    console.log("Number of Rows:", arrowTable.numRows);
    console.log("Schema:", arrowTable.schema);

    // Proceed with processing the arrowTable
    const geojson = convertArrowToGeoJSON(arrowTable);
    return geojson;
}




// Import WKBLoader for WKB parsing
import { WKBLoader } from 'https://cdn.skypack.dev/@loaders.gl/wkt';
// Function to convert Arrow table to GeoJSON
function convertArrowToGeoJSON(arrowTable) {
    const features = [];
    const numRows = arrowTable.numRows;
    const geometryColumnName = arrowTable.schema.fields.find(field => field.name === 'geometry').name;

    for (let i = 0; i < numRows; i++) {
        const properties = {};
        for (const field of arrowTable.schema.fields) {
            if (field.name !== geometryColumnName) {
                const column = arrowTable.getChild(field.name);
                properties[field.name] = column ? column.get(i) : null;
            }
        }
        const geometryColumn = arrowTable.getChild(geometryColumnName);
        const geometryData = geometryColumn ? geometryColumn.get(i) : null;
        const geometry = extractGeometryFromArrow(geometryData);

        if (geometry) {
            features.push({
                type: 'Feature',
                properties: properties,
                geometry: geometry,
            });
        }
    }

    return {
        type: 'FeatureCollection',
        features: features,
    };
}

// Function to extract geometry from Arrow table
function extractGeometryFromArrow(geometryData) {
    if (!geometryData) return null;
    try {
        if (geometryData instanceof Uint8Array) {
            const dataView = new DataView(geometryData.buffer, geometryData.byteOffset, geometryData.byteLength);
            const byteOrder = dataView.getUint8(0);
            const littleEndian = byteOrder === 1;
            const wkbType = dataView.getUint32(1, littleEndian);

            if (wkbType === 3) {
                const numRings = dataView.getUint32(5, littleEndian);
                let offset = 9;
                const coordinates = [];

                for (let i = 0; i < numRings; i++) {
                    const numPoints = dataView.getUint32(offset, littleEndian);
                    offset += 4;

                    const ringCoordinates = [];
                    for (let j = 0; j < numPoints; j++) {
                        const x = dataView.getFloat64(offset, littleEndian);
                        const y = dataView.getFloat64(offset + 8, littleEndian);
                        ringCoordinates.push([x, y]);
                        offset += 16;
                    }
                    coordinates.push(ringCoordinates);
                }

                return { type: 'Polygon', coordinates: coordinates };
            }
        }
    } catch (error) {
        console.error('Error parsing WKB:', error);
    }
    return null;
}



function updateMapLayer() {
    const selectedDay = daySelect.value;
    const data = dataCache[selectedDay];
    if (!data) return;

    // Get selected risk levels
    const selectedRiskLevels = Array.from(riskLevelSelect.selectedOptions).map(opt => parseInt(opt.value, 10));
    const selectedHHIIndicator = hhiIndicatorSelect.value;
    const percentileThresholdValue = parseFloat(percentileThreshold.value);

    // Calculate the percentile threshold for HHI
    const hhiThreshold = calculatePercentileThreshold(data, selectedHHIIndicator, percentileThresholdValue);

    // Filter features based on risk levels and HHI indicator
    const filteredFeatures = data.features.filter(feature => {
        const riskLevel = feature.properties.raster_value;
        const hhiValue = feature.properties[selectedHHIIndicator];

        const riskLevelMatch = selectedRiskLevels.includes(riskLevel);
        const hhiMatch = hhiValue !== null && !isNaN(hhiValue) && hhiValue >= hhiThreshold;

        return riskLevelMatch && hhiMatch;
    });

    // Check if the filtered data is empty
    if (filteredFeatures.length === 0) {
        console.warn('No data matches the selected filters. Please adjust your inputs.');
        return;
    }

    const filteredData = {
        type: 'FeatureCollection',
        features: filteredFeatures
    };

    // Create a new layer
    const newLayer = new deck.GeoJsonLayer({
        id: 'heat-risk-layer',
        data: filteredData,
        pickable: true,
        filled: true,
        stroked: false, // Disable the outline
        opacity: 0.6,
        getFillColor: f => {
            const riskLevel = f.properties.raster_value;
            switch (riskLevel) {
                case 0: return [255, 255, 204];
                case 1: return [255, 237, 160];
                case 2: return [254, 178, 76];
                case 3: return [253, 141, 60];
                case 4: return [240, 59, 32];
                default: return [189, 0, 38];
            }
        },
        getLineColor: [0, 0, 0],
        getLineWidth: 0.5,
        lineWidthUnits: 'pixels',
        autoHighlight: true,
        getTooltip: ({ object }) => {
            if (object) {
                console.log("bruh")
            }
        },
        onClick: info => {
            if (info.object) {
                const properties = info.object.properties;
                const riskLevel = properties.raster_value;
                const hhiValue = properties[selectedHHIIndicator];
                
                console.log("Clicked on:", properties, riskLevel, hhiValue)

            } else {
                console.warn('No feature found at the clicked point.');
            }
        }
        
        
        
    });

    // Update the layer
    deckgl.setProps({ layers: [newLayer] });

    // Use setProps to add getTooltip
    deckgl.setProps({
        getTooltip: ({ object }) => {
            if (object) {
                const properties = object.properties;
                const riskLevel = properties.raster_value;
                const hhiValue = properties[selectedHHIIndicator];

                return {
                    html: `
                        <div style="background: white; padding: 10px; border-radius: 4px;">
                            <strong>Heat Risk Level:</strong> ${riskLevel}<br>
                            <strong>${selectedHHIIndicator}:</strong> ${hhiValue}
                        </div>
                    `,
                    style: {
                        backgroundColor: 'rgba(255, 255, 255, 0.8)',
                        color: '#000',
                        fontSize: '12px',
                        padding: '8px',
                        borderRadius: '4px',
                        maxWidth: '300px',
                    }
                };
            }
            return null;
        }
    });
}


// Function to calculate percentile threshold
function calculatePercentileThreshold(data, indicator, percentile) {
    const values = data.features.map(f => f.properties[indicator]).filter(v => v !== null && !isNaN(v));
    values.sort((a, b) => a - b);
    const index = Math.floor(percentile / 100 * values.length);
    return values[index] || 0;
}

// Function to download filtered data
function downloadFilteredData() {
    const selectedDay = daySelect.value;
    const data = dataCache[selectedDay];
    if (!data) return;

    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `heat_risk_data_${selectedDay}.geojson`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// Function to load HHI description from CSV
async function loadHHIDescription() {
    const response = await fetch('data/HHI_Data_Dictionary_2024.csv');
    const csvText = await response.text();

    const hhiDescData = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
    });

    // Store the HHI descriptions for future use
    dataCache.hhiDescriptions = hhiDescData.data;

    // Populate HHI indicators
    populateHHIIndicators(hhiDescData.data);
}


// Function to populate state options
function populateStateOptions(statesData) {
    stateSelect.innerHTML = '<option value="">Select a State</option>';
    const sortedStates = statesData.features.sort((a, b) => a.properties.NAME.localeCompare(b.properties.NAME));
    sortedStates.forEach(feature => {
        const option = document.createElement('option');
        option.value = feature.properties.NAME;
        option.text = feature.properties.NAME;
        stateSelect.add(option);
    });
}

// Function to populate county options
function populateCountyOptions(countiesData, selectedState = "") {
    countySelect.innerHTML = '<option value="">Select a County</option>';
    let counties = countiesData.features;

    // Filter counties by state if a state is selected
    if (selectedState !== "") {
        counties = counties.filter(feature => feature.properties.STATE_NAME === selectedState);
    }

    // Sort counties alphabetically
    const sortedCounties = counties.sort((a, b) => a.properties.NAME.localeCompare(b.properties.NAME));

    sortedCounties.forEach(feature => {
        const option = document.createElement('option');
        option.value = feature.properties.NAME;
        option.text = feature.properties.NAME;
        countySelect.add(option);
    });
}


// Function to populate HHI indicators
function populateHHIIndicators(hhiDescriptions) {
    hhiIndicatorSelect.innerHTML = '';
    hhiDescriptions.forEach(indicator => {
        const option = document.createElement('option');
        option.value = indicator['weighted_2024_VARIABLE_NAME']; // Use bracket notation to access the column
        option.text = indicator['2024_VARIABLE_NAME']; // Correctly access the description field
        hhiIndicatorSelect.add(option);
    });
    // Set the default value to 'weighted_OVERALL_SCORE'
    hhiIndicatorSelect.value = 'weighted_OVERALL_SCORE';
    updateHHIIndicatorInfo();
    hhiIndicatorSelect.addEventListener('change', updateHHIIndicatorInfo);
}

// Function to update HHI Indicator Info
function updateHHIIndicatorInfo() {
    const selectedIndicator = hhiIndicatorSelect.value;
    const description = dataCache.hhiDescriptions.find(desc => desc.weighted_2024_VARIABLE_NAME === selectedIndicator);
    hhiIndicatorInfo.innerHTML = description ? `<p><strong>${selectedIndicator}:</strong></p><p>${description['2024_DESCRIPTION']}</p>` : 'No description available.';
    console.log(hhiIndicatorInfo.innerHTML)
}


// Dark mode
let isDarkMode = false; // Track dark mode state
const darkModeToggle = document.getElementById('dark-mode-toggle');
const infoModal = $('#infoModal'); // Using jQuery for Bootstrap modal

// Dark mode toggle event listener
darkModeToggle.addEventListener('click', () => {
    isDarkMode = !isDarkMode;
    document.body.classList.toggle('dark-mode', isDarkMode);
    updateMapStyle();

    // Update toggle icon
    const icon = darkModeToggle.querySelector('i');
    if (isDarkMode) {
        icon.classList.remove('fa-moon');
        icon.classList.add('fa-sun');
    } else {
        icon.classList.remove('fa-sun');
        icon.classList.add('fa-moon');
    }
});

// Function to update map style based on dark mode
function updateMapStyle() {
    deckgl.setProps({
        mapStyle: isDarkMode ? 'mapbox://styles/mapbox/dark-v10' : 'mapbox://styles/mapbox/light-v10'
    });
}

// ... [Previous app.js code]

// On page load, check localStorage for dark mode preference
document.addEventListener('DOMContentLoaded', () => {
    const darkModePreference = localStorage.getItem('darkMode');
    if (darkModePreference === 'enabled') {
        isDarkMode = true;
        document.body.classList.add('dark-mode');
        updateMapStyle();

        // Update toggle icon
        const icon = darkModeToggle.querySelector('i');
        icon.classList.remove('fa-moon');
        icon.classList.add('fa-sun');
    }
});
