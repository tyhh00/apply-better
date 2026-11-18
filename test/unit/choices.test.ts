// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { choiceValue, choose, findChoiceGroups, optionsOf, questionForGroup } from "../../src/content/choices";
import { findFields } from "../../src/content/fields";
import { pickOptions } from "../../src/shared/options";

beforeEach(() => (document.body.innerHTML = ""));
const only = () => {
  const gs = findChoiceGroups(document);
  expect(gs).toHaveLength(1);
  return gs[0];
};

// Zoho Forms: hidden native radios inside a labelled radiogroup, a label per option.
const ZOHO = `
<li id="Radio1-li" class="zfradio tempFrmWrapper"><label id="Radio1-arialabel" class="labelName">Ethnicity <em>*</em></label>
  <div class="tempContDiv"><div class="overflow customRadioBtn" role="radiogroup" aria-labelledby="Radio1-arialabel">
    <span><input type="radio" id="Radio1_1" name="Radio1" value="Chinese" class="radioBtnType" style="width:0;height:0"><label for="Radio1_1">Chinese</label></span>
    <span><input type="radio" id="Radio1_2" name="Radio1" value="Malay" class="radioBtnType"><label for="Radio1_2">Malay</label></span>
    <span><input type="radio" id="Radio1_3" name="Radio1" value="Indian" class="radioBtnType"><label for="Radio1_3">Indian</label></span>
  </div></div></li>`;

describe("radio buttons", () => {
  it("reads a Zoho question, its options and your pick", () => {
    document.body.innerHTML = ZOHO;
    const g = only();
    expect(questionForGroup(g)).toBe("Ethnicity");
    expect(optionsOf(g).map((o) => o.label)).toEqual(["Chinese", "Malay", "Indian"]);
    expect(choiceValue(g)).toBe("");
    (document.getElementById("Radio1_1") as HTMLInputElement).click();
    expect(choiceValue(g)).toBe("Chinese");
  });

  it("picks an option by name and leaves the others", () => {
    document.body.innerHTML = ZOHO;
    expect(choose(only(), "malay")).toBe(true);
    expect(choiceValue(only())).toBe("Malay");
    expect(choose(only(), "Eurasian")).toBe(false);
    expect(choiceValue(only())).toBe("Malay");
  });

  it("reads Google Forms radios, which have no inputs at all", () => {
    document.body.innerHTML = `
      <div role="listitem"><div role="heading">Can you work in Singapore?</div>
        <div role="radiogroup"><div role="radio" aria-checked="false" data-value="Yes" aria-label="Yes"></div>
        <div role="radio" aria-checked="true" data-value="No" aria-label="No"></div></div></div>`;
    const g = only();
    expect(g.type).toBe("aria-radio");
    expect(questionForGroup(g)).toBe("Can you work in Singapore?");
    expect(choiceValue(g)).toBe("No");
  });

  it("uses a fieldset legend that belongs to one question, not one that wraps a whole section", () => {
    document.body.innerHTML = `
      <fieldset><legend>About you</legend>
        <label for="n">Name</label><input id="n">
        <div><p>Open to relocation?</p><label><input type="radio" name="r" value="y"> Yes</label><label><input type="radio" name="r" value="n"> No</label></div>
      </fieldset>
      <fieldset><legend>Preferred start</legend><label><input type="radio" name="s"> Now</label><label><input type="radio" name="s"> Later</label></fieldset>`;
    const [reloc, start] = findChoiceGroups(document);
    expect(questionForGroup(reloc)).toBe("Open to relocation?");
    expect(questionForGroup(start)).toBe("Preferred start");
  });
});

describe("checkboxes", () => {
  it("reads every pick and sets exactly the ones asked for", () => {
    document.body.innerHTML = `
      <div><label id="q">Which roles interest you?</label>
      <div role="group" aria-labelledby="q">
        <label><input type="checkbox" name="roles" value="eng"> Engineering</label>
        <label><input type="checkbox" name="roles" value="des" checked> Design</label>
        <label><input type="checkbox" name="roles" value="pm"> Product</label></div></div>`;
    const g = only();
    expect(questionForGroup(g)).toBe("Which roles interest you?");
    expect(choiceValue(g)).toBe("Design");
    expect(choose(g, "Engineering; Product")).toBe(true);
    expect(choiceValue(only())).toBe("Engineering; Product");
  });
});

describe("dropdowns", () => {
  it("reads a <select>, skipping its placeholder", () => {
    document.body.innerHTML = `<label for="h">How did you hear about us?</label>
      <select id="h"><option value="">-Select-</option><option>LinkedIn</option><option>A friend</option></select>`;
    const g = only();
    expect(questionForGroup(g)).toBe("How did you hear about us?");
    expect(optionsOf(g).map((o) => o.label)).toEqual(["LinkedIn", "A friend"]);
    let changed = 0;
    document.querySelector("select")!.addEventListener("change", () => changed++);
    expect(choose(g, "A friend")).toBe(true);
    expect(choiceValue(g)).toBe("A friend");
    expect(changed).toBe(1); // so widgets like select2 redraw
  });

  it("reads a select2 dropdown: a hidden <select> with its own search box that is not a question", () => {
    document.body.innerHTML = `<li><label class="labelName">Nationality</label><div>
      <select style="display:none"><option value="-Select-">-Select-</option><option>Singaporean</option><option>Malaysian</option></select>
      <span class="select2 select2-container"><span role="combobox">-Select-</span></span></div></li>
      <span class="select2-container select2-container--open"><input type="search" class="select2-search__field"><ul role="listbox"><li role="option">Singaporean</li></ul></span>`;
    const g = only();
    expect(questionForGroup(g)).toBe("Nationality");
    expect(findFields(document)).toHaveLength(0);
  });
});

describe("pickOptions", () => {
  const opts = ["Yes, I'm authorised to work here", "No", "Not sure"];
  it("matches exact options, ignoring case and punctuation", () => expect(pickOptions("no", opts, false)).toEqual(["No"]));
  it("matches a short answer to a longer option on whole words", () => expect(pickOptions("Yes", opts, false)).toEqual(["Yes, I'm authorised to work here"]));
  it("never lets 'No' pick 'Not sure'", () => expect(pickOptions("No", ["Not sure", "Maybe"], false)).toBeNull());
  it("splits several picks on semicolons", () => expect(pickOptions("Design; engineering", ["Engineering", "Design"], true)).toEqual(["Design", "Engineering"]));
  it("refuses anything that isn't an option", () => expect(pickOptions("Purple", opts, false)).toBeNull());
});
