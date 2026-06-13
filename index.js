// --- Global State ---
let speciesSummaries = [];
let activeSpecies = null;
let activeSighting = null;
let activeDocId = null;

// Select elements (initialized dynamically in init)
let elTxtSearch, elSelCounty, elSelYear, elLstSpecies, elDivPlaceholder, elDivExplorer, elLblSpeciesName, elLblSpeciesMeta, elGridSightings;
let elModalDetails, elBtnCloseModal, elLblModalTitle, elLblModalSubtitle, elLblModalYear, elLblModalLocation, elLblModalCounty, elLblModalObservers, elDivCommentsSection, elLblModalComments, elLblModalCitations, elTabHeaders, elTabContents;
let elLightboxOverlay, elLightboxImg, elLightboxCaption, elBtnCloseLightbox;

function initElements() {
    elTxtSearch = document.getElementById('txt_search');
    elSelCounty = document.getElementById('sel_county');
    elSelYear = document.getElementById('sel_year');
    elLstSpecies = document.getElementById('lst_species');
    elDivPlaceholder = document.getElementById('div_placeholder');
    elDivExplorer = document.getElementById('div_explorer');
    elLblSpeciesName = document.getElementById('lbl_species_name');
    elLblSpeciesMeta = document.getElementById('lbl_species_meta');
    elGridSightings = document.getElementById('grid_sightings');

    // Modal Elements
    elModalDetails = document.getElementById('modal_details');
    elBtnCloseModal = document.getElementById('btn_close_modal');
    elLblModalTitle = document.getElementById('lbl_modal_title');
    elLblModalSubtitle = document.getElementById('lbl_modal_subtitle');
    elLblModalYear = document.getElementById('lbl_modal_year');
    elLblModalLocation = document.getElementById('lbl_modal_location');
    elLblModalCounty = document.getElementById('lbl_modal_county');
    elLblModalObservers = document.getElementById('lbl_modal_observers');
    elDivCommentsSection = document.getElementById('div_comments_section');
    elLblModalComments = document.getElementById('lbl_modal_comments');
    elLblModalCitations = document.getElementById('lbl_modal_citations');
    elTabHeaders = document.getElementById('tab_headers');
    elTabContents = document.getElementById('tab_contents');

    // Lightbox Elements
    elLightboxOverlay = document.getElementById('lightbox_overlay');
    elLightboxImg = document.getElementById('lightbox_img');
    elLightboxCaption = document.getElementById('lightbox_caption');
    elBtnCloseLightbox = document.getElementById('btn_close_lightbox');
}

// --- Helper Functions ---
function sanitizeFilename(name) {
    return name.replace(/[\\/*?:"<>|]/g, "_").trim();
}

// Format date to local standard
function formatDate(dateStr) {
    if (!dateStr) return "-";
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
        return dateStr;
    }
}

// --- App Initialization ---
async function init() {
    initElements();
    try {
        const resp = await fetch('data/species_summaries.json');
        if (!resp.ok) throw new Error("Failed to load species summaries (HTTP " + resp.status + ")");
        speciesSummaries = await resp.json();
        
        // Remove error entries
        speciesSummaries = speciesSummaries.filter(s => s && !s.error);
        
        // 2. Setup filters and species list
        populateFilters();
        renderSpeciesList();
        
        // 3. Event listeners
        if (elTxtSearch) elTxtSearch.addEventListener('input', handleFilterChange);
        if (elSelCounty) elSelCounty.addEventListener('change', handleFilterChange);
        if (elSelYear) elSelYear.addEventListener('change', handleFilterChange);
        
        if (elBtnCloseModal) elBtnCloseModal.addEventListener('click', closeModal);
        if (elModalDetails) {
            elModalDetails.addEventListener('click', (e) => {
                if (e.target === elModalDetails) closeModal();
            });
        }
        
        if (elBtnCloseLightbox) elBtnCloseLightbox.addEventListener('click', closeLightbox);
        if (elLightboxOverlay) {
            elLightboxOverlay.addEventListener('click', (e) => {
                if (e.target === elLightboxOverlay) closeLightbox();
            });
        }
        
    } catch (err) {
        console.error("Initialization error:", err);
        if (elLstSpecies) {
            elLstSpecies.innerHTML = `<div class="loading-spinner" style="flex-direction:column;gap:10px;text-align:center;padding:20px;"><i class="fa-solid fa-circle-exclamation" style="color:#ff6b6b;font-size:2rem;"></i> <div>Error loading summaries:</div><div style="font-family:monospace;font-size:0.8rem;color:#ff6b6b;word-break:break-all;max-width:300px;line-height:1.4;">${err.message}<br>${err.stack}</div></div>`;
        }
    }
}

// Safely execute init depending on readyState
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// --- Populate Counties & Years Dropdowns ---
function populateFilters() {
    const counties = new Set();
    const years = new Set();
    
    speciesSummaries.forEach(species => {
        if (species.records) {
            species.records.forEach(rec => {
                if (rec.county && typeof rec.county === 'string') {
                    counties.add(rec.county.trim());
                }
                if (rec.year && typeof rec.year === 'string') {
                    years.add(rec.year.trim());
                }
            });
        }
    });
    
    // Sort and fill counties
    if (elSelCounty) {
        Array.from(counties).sort().forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            elSelCounty.appendChild(opt);
        });
    }
    
    // Sort and fill years (descending)
    if (elSelYear) {
        Array.from(years).sort((a,b) => b - a).forEach(y => {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = y;
            elSelYear.appendChild(opt);
        });
    }
}

// --- Render Sidebar Species List ---
function renderSpeciesList(filteredSummaries = speciesSummaries) {
    elLstSpecies.innerHTML = '';
    
    if (filteredSummaries.length === 0) {
        elLstSpecies.innerHTML = `<div class="loading-spinner">No species found.</div>`;
        return;
    }
    
    const q = elTxtSearch.value.trim().toLowerCase();
    const county = elSelCounty.value;
    const year = elSelYear.value;
    
    filteredSummaries.forEach(species => {
        // Calculate filtered count dynamically
        const filteredCount = species.records.filter(rec => {
            const matchRecCounty = county === 'all' || rec.county === county;
            const matchRecYear = year === 'all' || rec.year === year;
            const matchQuery = q === '' || 
                               species.name.toLowerCase().includes(q) || 
                               (rec.observers && rec.observers.toLowerCase().includes(q)) || 
                               (rec.location && rec.location.toLowerCase().includes(q)) ||
                               (rec.acc_no && rec.acc_no.toLowerCase().includes(q));
            return matchRecCounty && matchRecYear && matchQuery;
        }).length;

        // Skip species with 0 records when filter is active
        if (filteredCount === 0 && (q !== '' || county !== 'all' || year !== 'all')) {
            return;
        }

        const li = document.createElement('li');
        li.className = `species-item ${activeSpecies && activeSpecies.species_id === species.species_id ? 'active' : ''}`;
        li.dataset.speciesId = species.species_id;
        
        li.innerHTML = `
            <span class="species-name">${species.name}</span>
            <span class="species-count">${filteredCount}</span>
        `;
        
        li.addEventListener('click', () => selectSpecies(species));
        elLstSpecies.appendChild(li);
    });
    
    // Check if list became empty after filtering out 0-count items
    if (elLstSpecies.children.length === 0) {
        elLstSpecies.innerHTML = `<div class="loading-spinner">No species found matching filters.</div>`;
    }
}

// --- Handle Sidebar Selection ---
async function selectSpecies(species) {
    activeSpecies = species;
    
    // Highlight sidebar selection
    document.querySelectorAll('.species-item').forEach(el => {
        if (el.dataset.speciesId === species.species_id) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    });
    
    // Fetch details
    const sanitizedName = sanitizeFilename(species.name);
    const detailUrl = `data/species/${species.species_id}_${sanitizedName}/details.json`;
    
    elGridSightings.innerHTML = `<div class="loading-spinner" style="grid-column: 1/-1;"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading sightings...</div>`;
    elDivPlaceholder.style.display = 'none';
    elDivExplorer.style.display = 'flex';
    elLblSpeciesName.textContent = species.name;
    elLblSpeciesMeta.textContent = `${species.records_count} Sighting Records`;
    
    try {
        const resp = await fetch(detailUrl);
        if (!resp.ok) throw new Error("Failed to load species details");
        const details = await resp.json();
        
        renderSightingsGrid(details.records);
    } catch (err) {
        console.error(err);
        elGridSightings.innerHTML = `<div class="loading-spinner" style="grid-column: 1/-1;"><i class="fa-solid fa-circle-exclamation" style="color:#ff6b6b"></i> Sighting details offline.</div>`;
    }
}

// --- Render Sighting Cards ---
function renderSightingsGrid(records) {
    elGridSightings.innerHTML = '';
    
    if (records.length === 0) {
        elGridSightings.innerHTML = `<div class="loading-spinner" style="grid-column: 1/-1;">No sightings match the filters.</div>`;
        return;
    }
    
    // Apply client-side filters (County & Year)
    const selectedCounty = elSelCounty.value;
    const selectedYear = elSelYear.value;
    
    const filtered = records.filter(rec => {
        const matchCounty = selectedCounty === 'all' || rec.county === selectedCounty;
        const matchYear = selectedYear === 'all' || rec.year === selectedYear;
        return matchCounty && matchYear;
    });
    
    if (filtered.length === 0) {
        elGridSightings.innerHTML = `<div class="loading-spinner" style="grid-column: 1/-1;">No records found matching county/year filters.</div>`;
        return;
    }
    
    filtered.forEach(rec => {
        const card = document.createElement('div');
        card.className = 'sighting-card card';
        
        card.innerHTML = `
            <div class="sighting-card-header">
                <span class="acc-badge">${rec.acc_no}</span>
                <span class="year-badge">${rec.year}</span>
            </div>
            <div class="sighting-card-body">
                <h3>${rec.location || 'Unknown Location'}</h3>
                <p><i class="fa-solid fa-tree"></i> ${rec.county || 'Unknown County'} County</p>
            </div>
            <div class="sighting-card-footer">
                <span class="observers-text" title="${rec.observers}"><i class="fa-solid fa-users"></i> ${rec.observers || 'Unknown Observers'}</span>
                <span class="btn-view">View Details <i class="fa-solid fa-angle-right"></i></span>
            </div>
        `;
        
        card.addEventListener('click', () => selectSighting(rec));
        elGridSightings.appendChild(card);
    });
}

// --- Handle Sighting Card Click & Open Modal ---
async function selectSighting(sighting) {
    activeSighting = sighting;
    
    // Set static fields
    elLblModalTitle.textContent = activeSpecies.name;
    elLblModalSubtitle.textContent = `Accession Number: ${sighting.acc_no}`;
    elLblModalYear.textContent = sighting.year || "-";
    elLblModalLocation.textContent = sighting.location || "-";
    elLblModalCounty.textContent = sighting.county || "-";
    elLblModalObservers.textContent = sighting.observers || "-";
    
    // Fetch record metadata (comments, citations, documentations list)
    const sanitizedSpecies = sanitizeFilename(activeSpecies.name);
    const sanitizedAcc = sanitizeFilename(sighting.acc_no);
    const metaUrl = `data/species/${activeSpecies.species_id}_${sanitizedSpecies}/records/${sanitizedAcc}/metadata.json`;
    
    // Open Modal with loader
    elTabHeaders.innerHTML = `<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading documentation list...</div>`;
    elTabContents.innerHTML = '';
    elDivCommentsSection.style.display = 'none';
    elModalDetails.classList.add('active');
    
    try {
        const resp = await fetch(metaUrl);
        if (!resp.ok) throw new Error("Failed to load record metadata");
        const metadata = await resp.json();
        
        // Render comments & citations if present
        if (metadata.comments || metadata.citations) {
            elLblModalComments.textContent = metadata.comments || "No committee comments available.";
            elLblModalCitations.textContent = metadata.citations || "No publication citations available.";
            elDivCommentsSection.style.display = 'grid';
        }
        
        // Render documentations tabs
        renderDocumentationTabs(metadata.documentations);
        
    } catch (err) {
        console.error(err);
        elTabHeaders.innerHTML = `<div class="loading-spinner" style="color:#ff6b6b"><i class="fa-solid fa-circle-exclamation"></i> Sighting documentation details offline.</div>`;
    }
}

// --- Render Documentation Tabs ---
function renderDocumentationTabs(documentations) {
    elTabHeaders.innerHTML = '';
    elTabContents.innerHTML = '';
    
    if (!documentations || documentations.length === 0) {
        elTabHeaders.innerHTML = `<div class="loading-spinner">No documentation reports uploaded.</div>`;
        return;
    }
    
    documentations.forEach((doc, idx) => {
        // Tab Header
        const tabBtn = document.createElement('button');
        tabBtn.className = `doc-tab ${idx === 0 ? 'active' : ''}`;
        tabBtn.dataset.docId = doc.doc_id;
        tabBtn.textContent = doc.reporter || `Report #${idx + 1}`;
        
        tabBtn.addEventListener('click', () => activateTab(doc.doc_id));
        elTabHeaders.appendChild(tabBtn);
        
        // Tab Content Panel (Empty for now, loaded dynamically on tab click)
        const contentDiv = document.createElement('div');
        contentDiv.className = `doc-content ${idx === 0 ? 'active' : ''}`;
        contentDiv.id = `doc_content_${doc.doc_id}`;
        contentDiv.innerHTML = `<div class="loading-spinner"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading report fields...</div>`;
        elTabContents.appendChild(contentDiv);
    });
    
    // Load the first tab automatically
    activateTab(documentations[0].doc_id);
}

// --- Activate Tab & Fetch Documentation Details ---
async function activateTab(docId) {
    activeDocId = docId;
    
    // Toggle tab header active class
    document.querySelectorAll('.doc-tab').forEach(btn => {
        if (btn.dataset.docId === docId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // Toggle content visible class
    document.querySelectorAll('.doc-content').forEach(content => {
        if (content.id === `doc_content_${docId}`) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });
    
    const contentPanel = document.getElementById(`doc_content_${docId}`);
    
    // If already loaded, do not fetch again
    if (contentPanel.dataset.loaded === 'true') return;
    
    const sanitizedSpecies = sanitizeFilename(activeSpecies.name);
    const sanitizedAcc = sanitizeFilename(activeSighting.acc_no);
    const docUrl = `data/species/${activeSpecies.species_id}_${sanitizedSpecies}/records/${sanitizedAcc}/doc_${docId}.json`;
    
    try {
        const resp = await fetch(docUrl);
        if (!resp.ok) throw new Error("Failed to load documentation details");
        const docData = await resp.json();
        
        renderDocFields(contentPanel, docData);
        contentPanel.dataset.loaded = 'true';
    } catch (err) {
        console.error(err);
        contentPanel.innerHTML = `<div class="loading-spinner" style="color:#ff6b6b"><i class="fa-solid fa-circle-exclamation"></i> Error loading report details.</div>`;
    }
}

// --- Render Documentation Fields & Attachments ---
function renderDocFields(container, doc) {
    container.innerHTML = '';
    
    // 1. Info Fields Grid
    const grid = document.createElement('div');
    grid.className = 'doc-metadata-grid';
    
    const fields = [
        { label: 'Reporter', val: doc.reporter_name },
        { label: 'E-mail', val: doc.reporter_email },
        { label: 'Other Observers', val: doc.other_observers },
        { label: 'Date Submitted', val: formatDate(doc.date_submitted) },
        { label: 'Sighting Date', val: doc.first_date },
        { label: 'Plumage', val: doc.plumage },
        { label: 'Number of Birds', val: doc.number_of_birds },
        { label: 'Age', val: doc.age },
        { label: 'Sex', val: doc.sex }
    ];
    
    fields.forEach(f => {
        if (f.val) {
            const div = document.createElement('div');
            div.className = 'doc-field';
            div.innerHTML = `
                <span class="doc-label">${f.label}</span>
                <span class="doc-value">${f.val}</span>
            `;
            grid.appendChild(div);
        }
    });
    
    container.appendChild(grid);
    
    // 2. Bird Description text
    if (doc.description) {
        const descDiv = document.createElement('div');
        descDiv.className = 'doc-description';
        descDiv.innerHTML = `
            <h4>Description of the Bird</h4>
            <p>${doc.description}</p>
        `;
        container.appendChild(descDiv);
    }
    
    // 3. Attachments & Files Download
    if (doc.attachments && doc.attachments.length > 0) {
        const attSection = document.createElement('div');
        attSection.className = 'doc-attachments';
        attSection.innerHTML = `<h4>Documents & Attachments</h4>`;
        
        const btnGrid = document.createElement('div');
        btnGrid.className = 'attachments-grid';
        
        const gallery = document.createElement('div');
        gallery.className = 'image-gallery';
        
        let hasImages = false;
        
        doc.attachments.forEach(att => {
            const sanitizedSpecies = sanitizeFilename(activeSpecies.name);
            const sanitizedAcc = sanitizeFilename(activeSighting.acc_no);
            const sanitizedFilename = sanitizeFilename(att.filename);
            
            // Build the local folder path URL
            const fileUrl = `data/species/${activeSpecies.species_id}_${sanitizedSpecies}/records/${sanitizedAcc}/files_${doc.doc_id}/${sanitizedFilename}`;
            
            // Check if file is image
            const isImage = /\.(jpg|jpeg|png|gif|JPG|PNG|JPEG)$/i.test(att.filename);
            
            if (isImage) {
                hasImages = true;
                const imgCard = document.createElement('div');
                imgCard.className = 'gallery-item';
                imgCard.innerHTML = `
                    <img src="${fileUrl}" alt="${att.filename}" onerror="this.src='../images/Select.png'">
                    <div class="gallery-item-caption">${att.filename}</div>
                `;
                imgCard.addEventListener('click', () => openLightbox(fileUrl, att.filename));
                gallery.appendChild(imgCard);
            } else {
                const btn = document.createElement('a');
                btn.className = 'attachment-button';
                btn.href = fileUrl;
                btn.target = '_blank';
                btn.innerHTML = `
                    <i class="fa-solid fa-file-pdf"></i>
                    <span>${att.filename}</span>
                `;
                btnGrid.appendChild(btn);
            }
        });
        
        if (btnGrid.children.length > 0) {
            attSection.appendChild(btnGrid);
        }
        if (hasImages) {
            attSection.appendChild(gallery);
        }
        
        container.appendChild(attSection);
    }
}

// --- Lightbox Functions ---
function openLightbox(url, filename) {
    elLightboxImg.src = url;
    elLightboxCaption.textContent = filename;
    elLightboxOverlay.classList.add('active');
}

function closeLightbox() {
    elLightboxOverlay.classList.remove('active');
}

// --- Close Modal ---
function closeModal() {
    elModalDetails.classList.remove('active');
}

// --- Handle Filters (Search Input, County, Year) ---
function handleFilterChange() {
    const q = elTxtSearch.value.trim().toLowerCase();
    const county = elSelCounty.value;
    const year = elSelYear.value;
    
    // 1. Filter summaries sidebar list
    const filtered = speciesSummaries.filter(species => {
        // If all filters are cleared, show all species
        if (q === '' && county === 'all' && year === 'all') {
            return true;
        }
        
        // Return true if at least one record satisfies the county, year, and query filters
        return species.records.some(rec => {
            const matchRecCounty = county === 'all' || rec.county === county;
            const matchRecYear = year === 'all' || rec.year === year;
            
            const matchQuery = q === '' || 
                               species.name.toLowerCase().includes(q) || 
                               (rec.observers && rec.observers.toLowerCase().includes(q)) || 
                               (rec.location && rec.location.toLowerCase().includes(q)) ||
                               (rec.acc_no && rec.acc_no.toLowerCase().includes(q));
                               
            return matchRecCounty && matchRecYear && matchQuery;
        });
    });
    
    renderSpeciesList(filtered);
    
    // 2. If active species is selected, refresh its record grid with filters
    if (activeSpecies) {
        // Find the active species in the main summaries list (to fetch complete records)
        const sp = speciesSummaries.find(s => s.species_id === activeSpecies.species_id);
        if (sp) {
            // Fetch dynamic records currently loaded (renderSightingsGrid handles county & year filters internally)
            const detailUrl = `data/species/${sp.species_id}_${sanitizeFilename(sp.name)}/details.json`;
            fetch(detailUrl)
                .then(r => r.json())
                .then(details => {
                    renderSightingsGrid(details.records);
                })
                .catch(() => {});
        }
    }
}
