import os
import re
import json
import time
import urllib.request
import urllib.parse
from bs4 import BeautifulSoup
import concurrent.futures
import logging
from datetime import datetime

# Setup logging
os.makedirs("/Users/henrys/source/cobrc/data", exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(threadName)s - %(message)s',
    handlers=[
        logging.FileHandler("/Users/henrys/source/cobrc/data/scraper.log"),
        logging.StreamHandler()
    ]
)

# Constants
BASE_URL = "https://cobrc.org"
SPECIES_DETAIL_URL = "https://cobrc.org/Reports/SpeciesDetail.aspx?id={}"
PRINT_DOC_URL = "https://cobrc.org/Reports/PrintDoc.aspx?DocID={}"
DATA_DIR = "/Users/henrys/source/cobrc/data"
SPECIES_DIR = os.path.join(DATA_DIR, "species")

# Field mapping for PrintDoc spans
FIELD_MAPPING = {
    'ContentPlaceHolder1_lblSpecies': 'species',
    'ContentPlaceHolder1_lblAccNo': 'acc_no',
    'ContentPlaceHolder1_lblFullName': 'reporter_name',
    'ContentPlaceHolder1_lblAddress': 'address',
    'ContentPlaceHolder1_lblCity': 'city',
    'ContentPlaceHolder1_lblState': 'state',
    'ContentPlaceHolder1_lblZip': 'zip',
    'ContentPlaceHolder1_lblEmail': 'reporter_email',
    'ContentPlaceHolder1_lblOtherObservers': 'other_observers',
    'ContentPlaceHolder1_lblSpeciesName': 'species_name',
    'ContentPlaceHolder1_lblFirstDate': 'first_date',
    'ContentPlaceHolder1_lblLastDate': 'last_date',
    'ContentPlaceHolder1_lblDuration': 'duration',
    'ContentPlaceHolder1_lblCounty': 'county',
    'ContentPlaceHolder1_lblLocation': 'specific_location',
    'ContentPlaceHolder1_lblHowMany': 'number_of_birds',
    'ContentPlaceHolder1_lblAge': 'age',
    'ContentPlaceHolder1_lblSex': 'sex',
    'ContentPlaceHolder1_lblPlumage': 'plumage',
    'ContentPlaceHolder1_lblDescription': 'description',
    'ContentPlaceHolder1_lblPhotographer': 'photographer',
    'ContentPlaceHolder1_lblPhotos': 'photos_text',
    'ContentPlaceHolder1_lblUploads': 'uploads_text',
    'ContentPlaceHolder1_lblSubmitted': 'date_submitted',
}

def sanitize_filename(name):
    # Replace slashes, backslashes, colons, etc.
    return re.sub(r'[\\/*?:"<>|]', '_', name).strip()

def http_get(url, retries=3, backoff=2):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=15) as response:
                return response.read()
        except Exception as e:
            if i == retries - 1:
                raise e
            time.sleep(backoff ** i)

def http_post(url, data, retries=3, backoff=2):
    encoded_data = urllib.parse.urlencode(data).encode('utf-8')
    for i in range(retries):
        try:
            req = urllib.request.Request(url, data=encoded_data, headers={
                'User-Agent': 'Mozilla/5.0',
                'Content-Type': 'application/x-www-form-urlencoded'
            })
            with urllib.request.urlopen(req, timeout=15) as response:
                return response.read()
        except Exception as e:
            if i == retries - 1:
                raise e
            time.sleep(backoff ** i)

def download_file(file_url, target_path):
    if os.path.exists(target_path):
        return True
    try:
        # Properly quote the path part of the URL to handle spaces and special chars
        parsed_url = urllib.parse.urlparse(file_url)
        quoted_path = urllib.parse.quote(parsed_url.path)
        clean_url = urllib.parse.urlunparse(parsed_url._replace(path=quoted_path))
        
        req = urllib.request.Request(clean_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as response:
            data = response.read()
        with open(target_path, "wb") as f:
            f.write(data)
        logging.info(f"Downloaded file: {clean_url} -> {os.path.basename(target_path)}")
        return True
    except Exception as e:
        logging.error(f"Failed to download file {file_url}: {e}")
        return False

def process_documentation(doc_id, record_dir):
    doc_json_path = os.path.join(record_dir, f"doc_{doc_id}.json")
    doc_html_path = os.path.join(record_dir, f"doc_{doc_id}.html")
    files_dir = os.path.join(record_dir, f"files_{doc_id}")
    
    # Check if doc exists
    if os.path.exists(doc_json_path) and os.path.exists(doc_html_path):
        # Even if metadata exists, make sure files are downloaded
        try:
            with open(doc_json_path, 'r') as f:
                doc_data = json.load(f)
            files_downloaded = True
            if 'attachments' in doc_data:
                for att in doc_data['attachments']:
                    att_url = BASE_URL + att['url']
                    att_name = att['filename']
                    target_file = os.path.join(files_dir, sanitize_filename(att_name))
                    if not os.path.exists(target_file):
                        files_downloaded = False
                        break
            if files_downloaded:
                return True
        except Exception:
            pass

    logging.info(f"Fetching documentation {doc_id}...")
    doc_url = PRINT_DOC_URL.format(doc_id)
    try:
        html_data = http_get(doc_url)
        doc_html = html_data.decode('utf-8', errors='ignore')
    except Exception as e:
        logging.error(f"Error fetching documentation {doc_id}: {e}")
        return False

    # Save raw HTML
    with open(doc_html_path, "w", encoding='utf-8') as f:
        f.write(doc_html)

    # Parse fields
    soup = BeautifulSoup(doc_html, 'html.parser')
    doc_data = {'doc_id': doc_id, 'scraped_at': datetime.now().isoformat()}
    
    for span_id, field_name in FIELD_MAPPING.items():
        span = soup.find('span', {'id': span_id})
        if span:
            doc_data[field_name] = span.text.strip()
            
    # Find all file attachments in RecordUploads
    attachments = []
    links = soup.find_all('a')
    for link in links:
        href = link.get('href', '')
        if 'RecordUploads' in href:
            filename = os.path.basename(href)
            if href.startswith('/'):
                url_path = href
            else:
                url_path = '/' + href
            # Deduplicate attachments
            if not any(att['url'] == url_path for att in attachments):
                attachments.append({
                    'filename': filename,
                    'url': url_path
                })
                
    doc_data['attachments'] = attachments
    
    # Save parsed documentation json
    with open(doc_json_path, "w", encoding='utf-8') as f:
        json.dump(doc_data, f, indent=2)

    # Download attachments
    if attachments:
        os.makedirs(files_dir, exist_ok=True)
        for att in attachments:
            att_url = BASE_URL + att['url']
            att_name = att['filename']
            target_file = os.path.join(files_dir, sanitize_filename(att_name))
            download_file(att_url, target_file)

    return True

def process_species(species_id, name):
    species_dir = os.path.join(SPECIES_DIR, f"{species_id}_{sanitize_filename(name)}")
    records_dir = os.path.join(species_dir, "records")
    details_json_path = os.path.join(species_dir, "details.json")
    
    # Check if species details are done
    # If details.json exists, we can read from it. Otherwise, we fetch it.
    species_details = None
    if os.path.exists(details_json_path):
        try:
            with open(details_json_path, 'r') as f:
                species_details = json.load(f)
        except Exception:
            pass

    url = SPECIES_DETAIL_URL.format(species_id)
    
    if not species_details:
        logging.info(f"Fetching species detail page for {name} ({species_id})...")
        try:
            html_data = http_get(url)
            html = html_data.decode('utf-8', errors='ignore')
        except Exception as e:
            logging.error(f"Error fetching species page {species_id}: {e}")
            return False

        soup = BeautifulSoup(html, 'html.parser')
        
        # Parse records from Grid1
        grid = soup.find('table', {'id': 'ContentPlaceHolder1_Grid1'})
        records = []
        if grid:
            rows = grid.find_all('tr')[1:] # Skip header
            for row_idx, row in enumerate(rows):
                cols = row.find_all('td')
                if len(cols) >= 6:
                    records.append({
                        'row_idx': row_idx,
                        'acc_no': cols[1].text.strip(),
                        'year': cols[2].text.strip(),
                        'location': cols[3].text.strip(),
                        'county': cols[4].text.strip(),
                        'observers': cols[5].text.strip()
                    })
        
        # Extract ASP.NET variables
        try:
            viewstate = soup.find('input', {'id': '__VIEWSTATE'})['value']
            viewstate_gen = soup.find('input', {'id': '__VIEWSTATEGENERATOR'})['value']
            event_validation = soup.find('input', {'id': '__EVENTVALIDATION'})['value']
        except Exception as e:
            logging.error(f"Error parsing ASP.NET parameters for species {species_id}: {e}")
            return False
            
        species_details = {
            'species_id': species_id,
            'name': name,
            'viewstate': viewstate,
            'viewstate_gen': viewstate_gen,
            'event_validation': event_validation,
            'records': records
        }
        
        os.makedirs(species_dir, exist_ok=True)
        with open(details_json_path, "w", encoding='utf-8') as f:
            json.dump(species_details, f, indent=2)

    # Process all records for this species
    records = species_details['records']
    if not records:
        logging.info(f"No records found for species {name}")
        return True

    logging.info(f"Processing {len(records)} records for species {name}...")
    
    # We must do postbacks sequentially per species thread because viewstate values are species-specific,
    # and doing them sequentially protects from thread race conditions on shared state.
    for rec in records:
        acc_no = rec['acc_no']
        sanitized_acc = sanitize_filename(acc_no)
        record_dir = os.path.join(records_dir, sanitized_acc)
        rec_metadata_path = os.path.join(record_dir, "metadata.json")
        
        # Check if record metadata already exists
        record_meta = None
        if os.path.exists(rec_metadata_path):
            try:
                with open(rec_metadata_path, 'r') as f:
                    record_meta = json.load(f)
            except Exception:
                pass
                
        if not record_meta:
            # We need to do the select postback
            logging.info(f"Selecting record {acc_no} (row {rec['row_idx']}) for {name}...")
            post_data = {
                '__VIEWSTATE': species_details['viewstate'],
                '__VIEWSTATEGENERATOR': species_details['viewstate_gen'],
                '__EVENTVALIDATION': species_details['event_validation'],
                '__EVENTTARGET': 'ctl00$ContentPlaceHolder1$Grid1',
                '__EVENTARGUMENT': f"Select${rec['row_idx']}",
                'ctl00$ContentPlaceHolder1$cboSpecies': str(species_id)
            }
            
            try:
                post_html_data = http_post(url, post_data)
                post_html = post_html_data.decode('utf-8', errors='ignore')
            except Exception as e:
                logging.error(f"Error selecting record {acc_no}: {e}")
                continue

            post_soup = BeautifulSoup(post_html, 'html.parser')
            
            # Extract comments and citations from dvMore
            comments = ""
            citations = ""
            dv_more = post_soup.find('table', {'id': 'ContentPlaceHolder1_dvMore'})
            if dv_more:
                rows = dv_more.find_all('tr')
                for r in rows:
                    cells = r.find_all('td')
                    if len(cells) >= 2:
                        label = cells[0].text.strip().lower()
                        val = cells[1].text.strip()
                        if 'comment' in label:
                            comments = val
                        elif 'citation' in label or 'publication' in label:
                            citations = val

            # Extract documentations list from gvDetails
            documentations = []
            gv_details = post_soup.find('table', {'id': 'ContentPlaceHolder1_gvDetails'})
            if gv_details:
                detail_rows = gv_details.find_all('tr')[1:] # Skip header
                for dr in detail_rows:
                    cells = dr.find_all('td')
                    if len(cells) >= 4:
                        link_el = cells[0].find('a')
                        doc_id = None
                        if link_el:
                            href = link_el.get('href', '')
                            # href looks like "PrintDoc.aspx?DocID=2639"
                            match = re.search(r'DocID=(\d+)', href)
                            if match:
                                doc_id = match.group(1)
                                
                        reporter = cells[1].text.strip()
                        date_str = cells[2].text.strip()
                        
                        # Photos checkbox check
                        has_photos = False
                        cb = cells[3].find('input', {'type': 'checkbox'})
                        if cb and cb.has_attr('checked'):
                            has_photos = True
                            
                        if doc_id:
                            documentations.append({
                                'doc_id': doc_id,
                                'reporter': reporter,
                                'date': date_str,
                                'has_photos': has_photos,
                                'doc_url': BASE_URL + "/Reports/" + href
                            })
                            
            record_meta = {
                'acc_no': acc_no,
                'year': rec['year'],
                'location': rec['location'],
                'county': rec['county'],
                'observers': rec['observers'],
                'comments': comments,
                'citations': citations,
                'documentations': documentations,
                'scraped_at': datetime.now().isoformat()
            }
            
            os.makedirs(record_dir, exist_ok=True)
            with open(rec_metadata_path, "w", encoding='utf-8') as f:
                json.dump(record_meta, f, indent=2)

        # Process documentations for this record
        doc_success = True
        for doc in record_meta.get('documentations', []):
            success = process_documentation(doc['doc_id'], record_dir)
            if not success:
                doc_success = False
                
        if doc_success:
            logging.info(f"Finished processing record {acc_no} successfully.")
        else:
            logging.warning(f"Record {acc_no} finished with some documentation failures.")
            
    return True

def main():
    logging.info("Starting COBRC Crawler...")
    
    # Load summaries JSON
    summary_path = os.path.join(DATA_DIR, "species_summaries.json")
    if not os.path.exists(summary_path):
        logging.error(f"Summaries file not found at {summary_path}. Run summaries extraction first.")
        return
        
    with open(summary_path, 'r') as f:
        summaries = json.load(f)
        
    logging.info(f"Loaded {len(summaries)} species summaries.")
    
    # Filter out entries with errors
    valid_species = [s for s in summaries if 'error' not in s]
    logging.info(f"Total valid species to crawl: {len(valid_species)}")
    
    # Shuffle or sort by records count (can process species with fewer records first)
    valid_species.sort(key=lambda s: s['records_count'])
    
    # We will use ThreadPoolExecutor to run species crawling in parallel.
    # Using 10 workers is polite and safe.
    max_workers = 10
    logging.info(f"Running species crawler with {max_workers} worker threads...")
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_species = {
            executor.submit(process_species, sp['species_id'], sp['name']): sp
            for sp in valid_species
        }
        
        completed = 0
        for future in concurrent.futures.as_completed(future_to_species):
            sp = future_to_species[future]
            completed += 1
            try:
                success = future.result()
                if success:
                    logging.info(f"[{completed}/{len(valid_species)}] Species {sp['name']} (ID {sp['species_id']}) processed successfully.")
                else:
                    logging.error(f"[{completed}/{len(valid_species)}] Species {sp['name']} (ID {sp['species_id']}) failed.")
            except Exception as e:
                logging.error(f"[{completed}/{len(valid_species)}] Exception processing species {sp['name']} (ID {sp['species_id']}): {e}")

    logging.info("COBRC Scraper execution completed!")

if __name__ == "__main__":
    main()
