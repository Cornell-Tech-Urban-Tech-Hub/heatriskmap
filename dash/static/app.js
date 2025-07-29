// ui








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
        <ul style="list-style: none; padding-left: 0;">
            <li><span style="display:inline-block; min-width:70px; background:#b5d18e; color:#222; font-weight:bold; border-radius:4px; padding:2px 8px;">Little 0</span> Little to no risk from expected heat.</li>
            <li><span style="display:inline-block; min-width:70px; background:#fff28c; color:#222; font-weight:bold; border-radius:4px; padding:2px 8px;">Minor 1</span> Affects primarily those extremely sensitive to heat.</li>
            <li><span style="display:inline-block; min-width:70px; background:#ffa749; color:#222; font-weight:bold; border-radius:4px; padding:2px 8px;">Moderate 2</span>Affects most individuals sensitive to heat.</li>
            <li><span style="display:inline-block; min-width:70px; background:#ff5757; color:#fff; font-weight:bold; border-radius:4px; padding:2px 8px;">Major 3</span> Affects anyone without effective cooling and/or adequate hydration.</li>
            <li><span style="display:inline-block; min-width:70px; background:#a349a4; color:#fff; font-weight:bold; border-radius:4px; padding:2px 8px;">Extreme 4</span> Rare and/or long-duration extreme heat with little to no overnight relief.</li>
        </ul>
    `;
}
function zoomToRegion(geometry) {
    let coordinates = [];

    // Determine the geometry type and extract coordinates
    if (geometry.type === 'Polygon') {
        // Collect coordinates from all rings of the polygon
        coordinates = geometry.coordinates.flat();
    } else if (geometry.type === 'MultiPolygon') {
        // Collect coordinates from all polygons and all rings
        geometry.coordinates.forEach(polygon => {
            coordinates.push(...polygon.flat());
        });
    } else {
        console.error('Unsupported geometry type:', geometry.type);
        return;
    }

    // Additional check for coordinates validity
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length === 0) {
        console.error('Invalid geometry coordinates:', coordinates);
        return;
    }

    // Calculate bounding box from the coordinates
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;

    try {
        coordinates.forEach(coord => {
            if (!Array.isArray(coord) || coord.length < 2) {
                console.error('Invalid coordinate:', coord);
                return;
            }
            const [lng, lat] = coord;
            if (lng < minLng) minLng = lng;
            if (lat < minLat) minLat = lat;
            if (lng > maxLng) maxLng = lng;
            if (lat > maxLat) maxLat = lat;
        });
    } catch (error) {
        console.error('Error while processing coordinates:', error);
        return;
    }

    // Calculate the center of the bounding box
    const centerLng = (minLng + maxLng) / 2;
    const centerLat = (minLat + maxLat) / 2;

    // Calculate the bounds size to determine zoom level
    const lngDiff = maxLng - minLng;
    const latDiff = maxLat - minLat;
    const maxDiff = Math.max(lngDiff, latDiff);

    // Determine a zoom level based on the size of the bounding box
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

let currentStartDate = new Date(); // Set to today's date in 'YYYY-MM-DD' format initially

// Load initial data
loadDataForSelectedDay(daySelect.value);

// Function to load data for the selected day
async function loadDataForSelectedDay(selectedDay) {
    const today = currentStartDate;
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
    console.log("First few rows of Arrow Table:");
    for (let i = 0; i < Math.min(5, arrowTable.numRows); i++) {
        console.log(`Row ${i}:`, arrowTable.get(i));
    }

    // Proceed with processing the arrowTable
    const geojson = convertArrowToGeoJSON(arrowTable);
    console.log("Generated GeoJSON:", geojson);
    console.log("Number of features in GeoJSON:", geojson.features.length);
    return geojson;
}

function convertArrowToGeoJSON(arrowTable) {
    const features = [];
    const numRows = arrowTable.numRows;
    const geometryColumnName = arrowTable.schema.fields.find(field => field.name === 'geometry').name;
    // console.log("Geometry column name:", geometryColumnName);

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

        // Log geometry data for each row to inspect its content
        // console.log(`Row ${i} geometry data:`, geometryData);

        // Attempt to parse the geometry, even if it might seem invalid
        let geometry = null;
        try {
            geometry = extractGeometryFromArrow(geometryData);
        } catch (error) {
            console.warn(`Error parsing geometry for row ${i}:`, error);
        }

        if (geometry) {
            features.push({
                type: 'Feature',
                properties: properties,
                geometry: geometry,
            });
        } else {
            console.warn(`Row ${i} has invalid or missing geometry data, but an attempt was made to parse it.`);
        }
    }

    // console.log("Finished converting Arrow table to GeoJSON.");
    return {
        type: 'FeatureCollection',
        features: features,
    };
}

// Function to extract geometry from Arrow table
function extractGeometryFromArrow(geometryData) {
    if (!geometryData) {
        console.warn('Geometry data is null or undefined.');
        return null;
    }

    try {
        if (geometryData instanceof Uint8Array) {
            const dataView = new DataView(geometryData.buffer, geometryData.byteOffset, geometryData.byteLength);
            const byteOrder = dataView.getUint8(0);
            const littleEndian = byteOrder === 1;
            const wkbType = dataView.getUint32(1, littleEndian);

            // console.log('WKB Type:', wkbType);

            // Attempt to handle different geometry types
            switch (wkbType) {
                case 3: // Polygon
                    return parsePolygon(dataView, littleEndian);
                case 6: // MultiPolygon
                    return parseMultiPolygon(dataView, littleEndian);
                default:
                    console.warn('Unsupported WKB type:', wkbType);
                    return null;
            }
        } else {
            console.warn('Geometry data is not of type Uint8Array.');
            return null;
        }
    } catch (error) {
        console.error('Error parsing geometry data:', error);
        return null;
    }
}
function parsePolygon(dataView, littleEndian) {
    try {
        // Read number of rings
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
    } catch (error) {
        console.error('Error parsing polygon data:', error);
        return null;
    }
}

function parseMultiPolygon(dataView, littleEndian) {
    try {
        const numPolygons = dataView.getUint32(5, littleEndian);
        let offset = 9;
        const coordinates = [];

        for (let i = 0; i < numPolygons; i++) {
            // Read byte order for this polygon
            const byteOrder = dataView.getUint8(offset);
            offset += 1;
            const polygonLittleEndian = byteOrder === 1;

            // Read geometry type
            let polygonType = dataView.getUint32(offset, polygonLittleEndian);
            offset += 4;

            // Mask out high bits (e.g., SRID, Z, M flags)
            const basePolygonType = polygonType & 0xFF;

            if (basePolygonType !== 3) { // Ensure the nested type is a Polygon
                console.warn('Unexpected geometry type within MultiPolygon:', basePolygonType);
                // Skip to the next polygon if the type is not a Polygon
                continue;
            }

            // Read number of rings
            const numRings = dataView.getUint32(offset, polygonLittleEndian);
            offset += 4;
            const polygonCoordinates = [];

            for (let j = 0; j < numRings; j++) {
                const numPoints = dataView.getUint32(offset, polygonLittleEndian);
                offset += 4;
                const ringCoordinates = [];

                for (let k = 0; k < numPoints; k++) {
                    const x = dataView.getFloat64(offset, polygonLittleEndian);
                    const y = dataView.getFloat64(offset + 8, polygonLittleEndian);
                    ringCoordinates.push([x, y]);
                    offset += 16;
                }
                polygonCoordinates.push(ringCoordinates);
            }
            coordinates.push(polygonCoordinates);
        }
        return { type: 'MultiPolygon', coordinates: coordinates };
    } catch (error) {
        console.error('Error parsing multipolygon data:', error);
        return null;
    }
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

    // Create the new heat risk layer
    const newLayer = new deck.GeoJsonLayer({
        id: 'heat-risk-layer',
        data: filteredData,
        pickable: true,
        filled: true,
        stroked: false, // Disable the outline
        opacity: 0.6,
        getFillColor: getFillColor, // Use the function to get fill color based on the selected scheme
        getLineColor: [0, 0, 0],
        getLineWidth: 0.5,
        lineWidthUnits: 'pixels',
        autoHighlight: true,
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
        },
        onClick: info => {
            if (info.object) {
                const properties = info.object.properties;
                const riskLevel = properties.raster_value;
                const hhiValue = properties[selectedHHIIndicator];

                console.log("Clicked on:", properties, riskLevel, hhiValue);
            } else {
                console.warn('No feature found at the clicked point.');
            }
        }
    });

    // Update the layers, keeping existing ones and replacing only the heat risk layer
    const currentLayers = deckgl.props.layers.filter(layer => layer.id !== 'heat-risk-layer');
    deckgl.setProps({ layers: [...currentLayers, newLayer] });


    // Use setProps to add getTooltip
    deckgl.setProps({
        getTooltip: ({ object }) => {
            if (object) {
                const properties = object.properties;
                const riskLevel = properties.raster_value;
                const hhiValue = properties[selectedHHIIndicator];

                return {
                    html: 
                        `<div style="background: white; padding: 10px; border-radius: 4px;">
                            <strong>Heat Risk Level:</strong> ${riskLevel}<br>
                            <strong>${selectedHHIIndicator}:</strong> ${hhiValue}
                        </div>`
                    ,
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

    
    // After updating the map layer, generate charts
    generatePopulationChart(filteredData);
    generateAge65Chart(filteredData);
}


// Function to generate population affected by heat risk level
function generatePopulationChart(data) {
    const populationByRisk = {};

    data.features.forEach(feature => {
        const riskLevel = feature.properties.raster_value;
        const population = feature.properties.weighted_POP || 0;
        if (populationByRisk[riskLevel]) {
            populationByRisk[riskLevel] += population;
        } else {
            populationByRisk[riskLevel] = population;
        }
    });

    const riskLevels = Object.keys(populationByRisk).sort();
    const populations = riskLevels.map(level => populationByRisk[level]);

    const trace = {
        x: populations,
        y: riskLevels,
        type: 'bar',
        orientation: 'h',
        marker: {
            color: riskLevels.map(level => {
                switch (parseInt(level, 10)) {
                    case 0: return 'rgb(255, 255, 204)';
                    case 1: return 'rgb(255, 237, 160)';
                    case 2: return 'rgb(254, 178, 76)';
                    case 3: return 'rgb(253, 141, 60)';
                    case 4: return 'rgb(240, 59, 32)';
                    default: return 'rgb(189, 0, 38)';
                }
            })
        }
    };

    const layout = {
        title: 'Population Affected by Heat Risk Level',
        xaxis: { title: 'Affected Population' },
        yaxis: { title: 'Heat Risk Level' },
        margin: { l: 100, r: 50, t: 50, b: 50 }
    };

    Plotly.newPlot('population-chart', [trace], layout);
}

// Function to generate age 65+ percentage chart
function generateAge65Chart(data) {
    const age65ByRisk = {};

    data.features.forEach(feature => {
        const riskLevel = feature.properties.raster_value;
        const age65 = feature.properties.weighted_P_AGE65 || 0;
        if (age65ByRisk[riskLevel]) {
            age65ByRisk[riskLevel].sum += age65;
            age65ByRisk[riskLevel].count += 1;
        } else {
            age65ByRisk[riskLevel] = { sum: age65, count: 1 };
        }
    });

    const riskLevels = Object.keys(age65ByRisk).sort();
    const age65Averages = riskLevels.map(level => (age65ByRisk[level].sum / age65ByRisk[level].count).toFixed(2));

    const trace = {
        x: age65Averages,
        y: riskLevels,
        type: 'bar',
        orientation: 'h',
        marker: {
            color: riskLevels.map(level => {
                switch (parseInt(level, 10)) {
                    case 0: return 'rgb(255, 255, 204)';
                    case 1: return 'rgb(255, 237, 160)';
                    case 2: return 'rgb(254, 178, 76)';
                    case 3: return 'rgb(253, 141, 60)';
                    case 4: return 'rgb(240, 59, 32)';
                    default: return 'rgb(189, 0, 38)';
                }
            })
        }
    };

    const layout = {
        title: 'Percentage of Persons Aged 65 and Older by Heat Risk Level',
        xaxis: { title: 'Percentage of Persons Aged 65 and Older (%)' },
        yaxis: { title: 'Heat Risk Level' },
        margin: { l: 150, r: 50, t: 50, b: 50 }
    };

    Plotly.newPlot('age65-chart', [trace], layout);
}



// Function to calculate percentile threshold
function calculatePercentileThreshold(data, indicator, percentile) {
    const values = data.features.map(f => f.properties[indicator]).filter(v => v !== null && !isNaN(v));
    values.sort((a, b) => a - b);
    
    // Handle edge cases
    if (values.length === 0) return 0;
    if (percentile <= 0) return values[0];
    if (percentile >= 100) return values[values.length - 1];
    
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
    
    // Log the full statesData to see its structure
    console.log("States Data:", statesData);

    const sortedStates = statesData.features.sort((a, b) => a.properties.NAME.localeCompare(b.properties.NAME));
    
    sortedStates.forEach(feature => {
        const stateName = feature.properties.NAME;
        console.log("Processing State:", stateName); // Log each state name being processed

        const option = document.createElement('option');
        option.value = stateName;
        option.text = stateName;
        stateSelect.add(option);
    });

    // Log the final state of the dropdown
    console.log("State dropdown options:", stateSelect.options);
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
    
    // Create a mapping of variable names to intuitive labels
    const labelMapping = {
        'weighted_OVERALL_SCORE': 'Overall HHI Score (Composite)',
        'weighted_OVERALL_RANK': 'Overall HHI Rank (Percentile)',
        'weighted_HHB_SCORE': 'Historical Heat Burden Score',
        'weighted_HHB_RANK': 'Historical Heat Burden Rank',
        'weighted_SEN_SCORE': 'Sensitivity Score',
        'weighted_SEN_RANK': 'Sensitivity Rank',
        'weighted_SOCIODEM_SCORE': 'Sociodemographic Score',
        'weighted_SOCIODEM_RANK': 'Sociodemographic Rank',
        'weighted_NBE_SCORE': 'Natural & Built Environment Score',
        'weighted_NBE_RANK': 'Natural & Built Environment Rank',
        'weighted_P_AGE65': 'Persons Aged 65+ (Percentage)',
        'weighted_PR_AGE65': 'Persons Aged 65+ (Percentile Rank)',
        'weighted_P_AGE5': 'Persons Under 5 Years (Percentage)',
        'weighted_PR_AGE5': 'Persons Under 5 Years (Percentile Rank)',
        'weighted_P_ASTHMA': 'Asthma Prevalence (Percentage)',
        'weighted_PR_ASTHMA': 'Asthma Prevalence (Percentile Rank)',
        'weighted_P_CHD': 'Coronary Heart Disease Prevalence (Percentage)',
        'weighted_PR_CHD': 'Coronary Heart Disease Prevalence (Percentile Rank)',
        'weighted_P_COPD': 'COPD Prevalence (Percentage)',
        'weighted_PR_COPD': 'COPD Prevalence (Percentile Rank)',
        'weighted_P_DIABETES': 'Diabetes Prevalence (Percentage)',
        'weighted_PR_DIABETES': 'Diabetes Prevalence (Percentile Rank)',
        'weighted_P_DISABL': 'Persons with Disability (Percentage)',
        'weighted_PR_DISABL': 'Persons with Disability (Percentile Rank)',
        'weighted_P_ELP': 'Limited English Proficiency (Percentage)',
        'weighted_PR_ELP': 'Limited English Proficiency (Percentile Rank)',
        'weighted_P_IMPERV': 'Impervious Surface Coverage (Percentage)',
        'weighted_PR_IMPERV': 'Impervious Surface Coverage (Percentile Rank)',
        'weighted_P_ISO': 'Persons Living Alone (Percentage)',
        'weighted_PR_ISO': 'Persons Living Alone (Percentile Rank)',
        'weighted_P_MNTLH': 'Poor Mental Health (Percentage)',
        'weighted_PR_MNTLH': 'Poor Mental Health (Percentile Rank)',
        'weighted_P_MOBILE': 'Mobile Homes (Percentage)',
        'weighted_PR_MOBILE': 'Mobile Homes (Percentile Rank)',
        'weighted_P_NEHD': 'Extreme Heat Days (Count)',
        'weighted_PR_NEHD': 'Extreme Heat Days (Percentile Rank)',
        'weighted_P_NOHSDP': 'No High School Diploma (Percentage)',
        'weighted_PR_NOHSDP': 'No High School Diploma (Percentile Rank)',
        'weighted_P_NOVEH': 'Households with No Vehicle (Percentage)',
        'weighted_PR_NOVEH': 'Households with No Vehicle (Percentile Rank)',
        'weighted_P_OBS': 'Obesity Prevalence (Percentage)',
        'weighted_PR_OBS': 'Obesity Prevalence (Percentile Rank)',
        'weighted_P_ODW': 'Outdoor Workers (Percentage)',
        'weighted_PR_ODW': 'Outdoor Workers (Percentile Rank)',
        'weighted_P_OZONE': 'Ozone Exceedance Days (Annual Average)',
        'weighted_PR_OZONE': 'Ozone Exceedance Days (Percentile Rank)',
        'weighted_P_PM25': 'PM2.5 Exceedance Days (Annual Average)',
        'weighted_PR_PM25': 'PM2.5 Exceedance Days (Percentile Rank)',
        'weighted_P_POV': 'Persons Below 150% Poverty (Percentage)',
        'weighted_PR_POV': 'Persons Below 150% Poverty (Percentile Rank)',
        'weighted_P_RENT': 'Renter-Occupied Housing (Percentage)',
        'weighted_PR_RENT': 'Renter-Occupied Housing (Percentile Rank)',
        'weighted_P_TREEC': 'Tree Canopy Coverage (Percentage)',
        'weighted_PR_TREEC': 'Tree Canopy Coverage (Percentile Rank)',
        'weighted_P_UNEMP': 'Unemployment Rate (Percentage)',
        'weighted_PR_UNEMP': 'Unemployment Rate (Percentile Rank)',
        'weighted_P_UNINSUR': 'Uninsured Population (Percentage)',
        'weighted_PR_UNINSUR': 'Uninsured Population (Percentile Rank)',
        'weighted_POP': 'Population Estimate'
    };
    
    // Create array of options with labels and values
    const options = hhiDescriptions
        .filter(indicator => labelMapping[indicator['weighted_2024_VARIABLE_NAME']]) // Only include mapped indicators
        .map(indicator => ({
            value: indicator['weighted_2024_VARIABLE_NAME'],
            label: labelMapping[indicator['weighted_2024_VARIABLE_NAME']]
        }))
        .sort((a, b) => a.label.localeCompare(b.label)); // Sort alphabetically by label
    
    // Add options to the select element
    options.forEach(option => {
        const optionElement = document.createElement('option');
        optionElement.value = option.value;
        optionElement.text = option.label;
        hhiIndicatorSelect.add(optionElement);
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
    localStorage.setItem('darkMode', isDarkMode ? "enabled" : "disabled")
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
const darkModePreference = localStorage.getItem('darkMode');
console.log("dark", darkModePreference)
if (darkModePreference === "enabled") {
    isDarkMode = true;
    document.body.classList.add('dark-mode');
    updateMapStyle();

    // Update toggle icon
    const icon = darkModeToggle.querySelector('i');
    icon.classList.remove('fa-moon');
    icon.classList.add('fa-sun');
}

// Elements
const startDateSelect = document.getElementById('start-date-select');

// Event listener for the start date selection
startDateSelect.addEventListener('change', () => {
    // Parse the selected date manually to ensure it's treated as local time
    const [year, month, day] = startDateSelect.value.split('-').map(Number);
    const selectedDate = new Date(year, month - 1, day); // Months are 0-based in JavaScript

    if (isNaN(selectedDate)) {
        alert('Please select a valid start date.');
        return;
    }

    // Generate date options for 7 consecutive days starting from the selected date
    const dateOptions = [];
    for (let i = 0; i < 7; i++) {
        const date = new Date(selectedDate); // Clone the selectedDate
        currentStartDate = new Date(date.getTime()); // Clone the date using getTime()
        console.log("date", currentStartDate)

        date.setDate(selectedDate.getDate() + i); // Add i days

        // Format the date as YYYY-MM-DD for consistency
        const formattedDate = date.toISOString().split('T')[0]; // 'YYYY-MM-DD'

        dateOptions.push(`Day ${i + 1} - ${formattedDate}`);
    }

    // Clear the existing options in the day select dropdown
    daySelect.innerHTML = '';

    // Populate the day select dropdown with the new date options
    dateOptions.forEach(optionText => {
        const option = document.createElement('option');
        option.value = optionText.split(' - ')[0]; // Extract 'Day 1', 'Day 2', etc. as the value
        option.text = optionText;
        daySelect.add(option);
    });

    loadDataForSelectedDay(daySelect.value);
});



// Function to list S3 objects and filter by available dates
async function listAvailableDates(bucketUrl) {
    const objects = [];
    let continuationToken = null;
    const availableDates = new Set();

    do {
        console.log('hitting url');
        const url = new URL(bucketUrl);
        url.searchParams.append('list-type', '2');
        if (continuationToken) {
            url.searchParams.append('continuation-token', continuationToken);
        }

        const response = await fetch(url);
        const text = await response.text();
        console.log(response);
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "text/xml");

        // Parse objects
        const contents = xmlDoc.getElementsByTagName('Contents');
        for (const content of contents) {
            const key = content.getElementsByTagName('Key')[0].textContent;
            objects.push(key);

            // Extract date from the key (updated regex to match YYYYMMDD format)
            const dateMatch = key.match(/\d{8}/); // Match format YYYYMMDD
            if (dateMatch) {
                // Convert YYYYMMDD to YYYY-MM-DD for consistency
                const formattedDate = dateMatch[0].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
                availableDates.add(formattedDate);
            }
        }

        // Check if there are more objects to fetch
        const isTruncated = xmlDoc.getElementsByTagName('IsTruncated')[0].textContent;
        if (isTruncated.toLowerCase() === 'true') {
            continuationToken = xmlDoc.getElementsByTagName('NextContinuationToken')[0].textContent;
        } else {
            continuationToken = null;
        }
    } while (continuationToken);

    return Array.from(availableDates); // Convert the set to an array
}

// Function to populate the date picker
async function populateDatePicker(bucketUrl) {
    try {
        console.log("test");
        const availableDates = await listAvailableDates(bucketUrl);
        console.log(availableDates);
        const startDateSelect = document.getElementById('start-date-select');

        // Set min and max attributes based on the available dates
        if (availableDates.length > 0) {
            const minDate = new Date(Math.min(...availableDates.map(date => new Date(date))));
            const maxDate = new Date(Math.max(...availableDates.map(date => new Date(date))));
            startDateSelect.min = minDate.toISOString().split('T')[0];
            startDateSelect.max = maxDate.toISOString().split('T')[0];
        }

        // Disable unavailable dates
        startDateSelect.addEventListener('input', () => {
            const selectedDate = startDateSelect.value;
            if (!availableDates.includes(selectedDate)) {
                alert('Selected date is not available. Please choose another date.');
                startDateSelect.value = ''; // Clear the invalid selection
            }
        });
    } catch (error) {
        console.error('Error fetching available dates:', error);
    }
}

// Usage example
const bucketUrl = 'https://heat-risk-dashboard.s3.amazonaws.com/';
populateDatePicker(bucketUrl);


// Define color schemes
const colorSchemes = {
    default: [
        [181, 209, 142], // Green (0) - #b5d18e
        [255, 242, 140], // Yellow (1) - #fff28c
        [255, 167, 73],  // Orange (2) - #ffa749
        [255, 87, 87],   // Red (3) - #ff5757
        [163, 73, 164]   // Magenta (4) - #a349a4
    ],
    colorblind: [
        [213, 94, 0],    // Orange
        [204, 121, 167], // Pink
        [0, 114, 178],   // Blue
        [240, 228, 66],  // Yellow
        [0, 158, 115],   // Green
        [0, 0, 0]        // Black for default
    ],
    differentiated: [
        [255, 0, 0],     // Red
        [0, 0, 255],     // Blue
        [0, 255, 0],     // Green
        [255, 255, 0],   // Yellow
        [255, 165, 0],   // Orange
        [128, 128, 128]  // Gray for default
    ],
    complementary: [
        [255, 255, 204], // Light Yellow
        [255, 217, 102], // Light Orange
        [255, 153, 51],  // Orange
        [255, 102, 0],   // Dark Orange
        [204, 51, 0],    // Red
        [153, 0, 0]      // Dark Red for default
    ]
};

// Get the selected color scheme from localStorage or set to 'default'
const selectedScheme = localStorage.getItem('colorScheme') || 'default';

// Function to get the fill color based on the selected scheme
function getFillColor(f) {
    const riskLevel = f.properties.raster_value;
    const selectedScheme = localStorage.getItem('colorScheme') || 'default';
    const colors = colorSchemes[selectedScheme] || colorSchemes.default;
    return colors[riskLevel] || colors[colors.length - 1]; // Default to last color if out of range
}

// Save color scheme selection to localStorage and refresh the map
document.getElementById('colorSchemeSelect').addEventListener('change', (event) => {
    const selectedOption = event.target.value;
    localStorage.setItem('colorScheme', selectedOption);
    updateMapLayer(); // Refresh the map with the new color scheme
});


// Set the dropdown to the stored color scheme on page load
const colorSchemeSelect = document.getElementById('colorSchemeSelect');
const storedScheme = localStorage.getItem('colorScheme') || 'default';
console.log(storedScheme)
// Ensure the dropdown reflects the stored color scheme
colorSchemeSelect.value = storedScheme;
